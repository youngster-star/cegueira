"""录制生产链（python/runtime/record.py + cli.py）测试。

覆盖 P2/A3 缺口：此前 `trace.json` / `tool_io.log` 没有任何生产者。这里用一个
临时 Agent 同时走三条通路——OTel span、agent 工具（timed_tool）、LLM HTTP——
再验证 record_agent 把它们归一化成三件套 + manifest.json。

关键验证点：
- 协议行被正确分派（span / tool_io / trace）；
- **span id 被原样保留**：嵌套时子 span 先结束先入列，若不透传 id 就会错位；
- 五件产物齐全（http.yaml / trace.json / tool_io.log / result.json / manifest.json）。

manifest 与 TS 侧 parseRecording 的同构由 test_manifest.py 的跨语言往返断言覆盖。
"""
import io
import json
import subprocess
import sys
import threading
from contextlib import redirect_stdout
from http.server import HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from python.replay.fakellm import FakeLLMHandler  # noqa: E402
from python.runtime import cli  # noqa: E402
from python.runtime.record import RecordError, record_agent  # noqa: E402

# 临时 Agent：同时触发三类协议行。ROOT 由本文件写入脚本，供其 import 本仓包。
AGENT_SOURCE = '''\
import json
import os
import sys
import urllib.request

sys.path.insert(0, {root!r})

from python.otel.collector import TraceCollector, trace_span
from python.otel.span import CHAIN, LLM, RETRIEVAL
from python.replay import protocol

LLM_URL = os.environ["LLM_URL"]


def call_llm(prompt):
    body = json.dumps({{"model": "fake", "messages": [{{"role": "user", "content": prompt}}]}}).encode("utf-8")
    req = urllib.request.Request(
        LLM_URL, data=body, headers={{"Content-Type": "application/json"}}, method="POST"
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))["choices"][0]["message"]["content"]


collector = TraceCollector(trace_id="t1")
# 嵌套：CHAIN(span-1) 外层，RETRIEVAL(span-2) 内层。内层先结束先发射。
with trace_span(collector, "chain", CHAIN):
    with trace_span(collector, "retrieve", RETRIEVAL, query="rag", returned_doc_ids=["d1", "d2"]):
        pass
# agent 级工具（source=agent），计时并发射
with protocol.timed_tool("retrieve", {{"query": "rag"}}) as ctx:
    ctx.result = ["d1", "d2"]
# LLM span（span-3）
with trace_span(collector, "chat", LLM, prompt_tokens=10, completion_tokens=5):
    answer = call_llm("什么是 RAG")

sys.stdout.write(json.dumps({{
    "type": "trace",
    "final_answer": {{"text": answer, "cited_doc_ids": ["d1"]}},
}}) + "\\n")
sys.stdout.flush()
'''


def _tmp_agent(tmp_path: Path) -> Path:
    agent_dir = tmp_path / "agent"
    agent_dir.mkdir()
    (agent_dir / "main.py").write_text(AGENT_SOURCE.format(root=str(ROOT)), encoding="utf-8")
    return agent_dir


class _fake_llm:
    """临时起一个 fake LLM 上游，返回其基址。"""

    def __enter__(self) -> str:
        self.server = HTTPServer(("127.0.0.1", 0), FakeLLMHandler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        host, port = self.server.server_address[:2]
        return f"http://{host}:{port}"

    def __exit__(self, *exc):
        self.server.shutdown()
        return False


def _record(tmp_path: Path):
    agent_dir = _tmp_agent(tmp_path)
    run_dir = tmp_path / "run"
    with _fake_llm() as upstream:
        res = record_agent(
            agent_dir, run_dir, python=sys.executable, upstream=upstream, timeout=60
        )
    return res, run_dir


def test_record_writes_all_artifacts():
    import tempfile

    tmp = Path(tempfile.mkdtemp(prefix="ceg-record-"))
    res, run_dir = _record(tmp)

    for name in ("http.yaml", "trace.json", "tool_io.log", "result.json", "manifest.json"):
        assert (run_dir / name).exists(), f"缺少产物 {name}"

    assert res.http_count == 1
    assert res.span_count == 3  # chain / retrieve / chat
    assert res.tool_io_count == 1
    assert res.result is not None


def test_manifest_normalization_and_span_id_preserved():
    import tempfile

    tmp = Path(tempfile.mkdtemp(prefix="ceg-record-"))
    _res, run_dir = _record(tmp)
    trace = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))["trace"]

    assert len(trace["http"]) == 1
    assert trace["http"][0]["request"]["host"] == "llm"
    assert [t["name"] for t in trace["tools"]] == ["retrieve"]
    assert len(trace["llmSpans"]) == 1
    assert trace["llmSpans"][0]["promptTokens"] == 10
    assert len(trace["retrievals"]) == 1
    assert trace["retrievals"][0]["returnedDocIds"] == ["d1", "d2"]

    # span id 必须原样保留：RETRIEVAL 是第二个创建、最先结束的 span → span-2。
    # 若 add_span 重新顺位分配，它会变成 span-1（于是 parent_id 指向错误对象）。
    assert trace["retrievals"][0]["id"] == "span-2", "span id 未被透传，嵌套父子关系会错位"

    assert trace["finalAnswer"]["citedDocIds"] == ["d1"]


def test_record_error_on_nonzero_exit():
    import tempfile

    tmp = Path(tempfile.mkdtemp(prefix="ceg-record-"))
    agent_dir = tmp / "bad"
    agent_dir.mkdir()
    (agent_dir / "main.py").write_text(
        "import sys; sys.stderr.write('boom\\n'); sys.exit(3)", encoding="utf-8"
    )
    try:
        record_agent(agent_dir, tmp / "run", python=sys.executable, timeout=30)
        assert False, "应抛 RecordError"
    except RecordError as e:
        assert "退出码 3" in str(e)
        assert "boom" in str(e)


def test_cli_record_prints_json_summary():
    import tempfile

    tmp = Path(tempfile.mkdtemp(prefix="ceg-record-"))
    agent_dir = _tmp_agent(tmp)
    run_dir = tmp / "run"

    buf = io.StringIO()
    with _fake_llm() as upstream, redirect_stdout(buf):
        code = cli.main(
            [
                "record",
                "--agent",
                str(agent_dir),
                "--out",
                str(run_dir),
                "--python",
                sys.executable,
                "--upstream",
                upstream,
            ]
        )

    assert code == 0
    summary = json.loads(buf.getvalue().strip())
    assert summary["http"] == 1
    assert summary["spans"] == 3
    assert summary["has_result"] is True


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    print(f"录制生产链测试全部通过 ✅（{len(tests)} 项）")


if __name__ == "__main__":
    main()
