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
import os
import subprocess
import sys
import threading
import time
from contextlib import redirect_stdout
from http.server import HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from python.replay.fakellm import FakeLLMHandler  # noqa: E402
from python.runtime import cli  # noqa: E402
from python.runtime.record import (  # noqa: E402
    RecordError,
    build_child_env,
    load_evalset,
    record_agent,
    record_cases,
    repo_root,
)

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


def test_build_child_env_injects_scaffold_and_forces_protocol():
    root = repo_root()
    env = build_child_env(
        {"CEG_MOCK_MODE": "record", "CEG_PROTOCOL": "0", "LLM_URL": "http://evil"},
        llm_url="http://proxy/v1/chat/completions",
        root=root,
        base={"PYTHONPATH": "C:\\user-libs"},
    )
    # 仓库根拼在已有 PYTHONPATH 之前（脚手架优先，不被用户同名目录遮蔽）
    assert env["PYTHONPATH"] == str(root) + os.pathsep + "C:\\user-libs"
    # 调用方的 CEG_PROTOCOL / LLM_URL 不可覆盖
    assert env["CEG_PROTOCOL"] == "1"
    assert env["LLM_URL"] == "http://proxy/v1/chat/completions"
    # 其余 env 原样保留
    assert env["CEG_MOCK_MODE"] == "record"


def test_build_child_env_without_existing_pythonpath():
    env = build_child_env(None, llm_url="u", root=repo_root(), base={})
    assert env["PYTHONPATH"] == str(repo_root())
    assert env["PYTHONIOENCODING"] == "utf-8"


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


# 逐 case 录制用的临时 Agent：把 CEG_CASE_PROMPT 回显进 final_answer，
# 且当 prompt 为 "boom" 时故意非零退出（验证单 case 失败不中断整体）。
PER_CASE_AGENT_SOURCE = '''\
import json
import os
import sys

sys.path.insert(0, {root!r})

from python.otel.collector import TraceCollector, trace_span
from python.otel.span import LLM

prompt = os.environ.get("CEG_CASE_PROMPT", "")
if prompt == "boom":
    sys.stderr.write("故意失败\\n")
    sys.exit(2)

with trace_span(TraceCollector(trace_id="t"), "chat", LLM, prompt_tokens=1, completion_tokens=1):
    pass

sys.stdout.write(json.dumps({{
    "type": "trace",
    "final_answer": {{"text": prompt, "cited_doc_ids": []}},
}}) + "\\n")
sys.stdout.flush()
'''


def test_load_evalset_validation():
    import tempfile

    tmp = Path(tempfile.mkdtemp(prefix="ceg-evalset-"))
    p = tmp / "evalset.json"
    p.write_text(
        json.dumps({"tests": [{"id": "c1", "prompt": "问题一"}]}), encoding="utf-8"
    )
    assert load_evalset(p) == [{"id": "c1", "prompt": "问题一"}]

    p.write_text(json.dumps({"tests": []}), encoding="utf-8")
    try:
        load_evalset(p)
        assert False, "空 tests 应报错"
    except RecordError:
        pass


def test_record_cases_runs_each_and_writes_index():
    import tempfile

    tmp = Path(tempfile.mkdtemp(prefix="ceg-cases-"))
    agent_dir = tmp / "agent"
    agent_dir.mkdir()
    (agent_dir / "main.py").write_text(
        PER_CASE_AGENT_SOURCE.format(root=str(ROOT)), encoding="utf-8"
    )
    cases = [{"id": "c1", "prompt": "问题一"}, {"id": "c2", "prompt": "问题二"}]
    index = record_cases(agent_dir, tmp / "run", cases, python=sys.executable, timeout=30)

    assert index["ran_case_ids"] == ["c1", "c2"]
    # 每个 case 一份三件套，且 final_answer 反映了该 case 的 prompt（逐 case 生效）
    for cid, prompt in [("c1", "问题一"), ("c2", "问题二")]:
        man = json.loads((tmp / "run" / cid / "manifest.json").read_text(encoding="utf-8"))
        assert man["trace"]["finalAnswer"]["text"] == prompt
    idx = json.loads((tmp / "run" / "cases.json").read_text(encoding="utf-8"))
    assert idx["ran_case_ids"] == ["c1", "c2"]


def test_record_cases_continues_after_case_failure():
    import tempfile

    tmp = Path(tempfile.mkdtemp(prefix="ceg-cases-"))
    agent_dir = tmp / "agent"
    agent_dir.mkdir()
    (agent_dir / "main.py").write_text(
        PER_CASE_AGENT_SOURCE.format(root=str(ROOT)), encoding="utf-8"
    )
    cases = [{"id": "c1", "prompt": "ok"}, {"id": "c2", "prompt": "boom"}]
    index = record_cases(agent_dir, tmp / "run", cases, python=sys.executable, timeout=30)

    # 失败 case 不中断整体：c1 成功、c2 记为 failed
    assert index["ran_case_ids"] == ["c1"]
    status = {c["id"]: c["status"] for c in index["cases"]}
    assert status == {"c1": "ok", "c2": "failed"}
    assert "error" in next(c for c in index["cases"] if c["id"] == "c2")


# 回显 mock 相关环境变量，用于验证产品化接线是否注入到位。
DEPS_AGENT_SOURCE = '''\
import json
import os
import sys

sys.stdout.write(json.dumps({
    "type": "trace",
    "final_answer": {"text": os.environ.get("CEG_DEPS_DIR", ""), "cited_doc_ids": []},
    "mock_mode": os.environ.get("CEG_MOCK_MODE", ""),
}) + "\\n")
sys.stdout.flush()
'''


def test_record_cases_defaults_deps_dir_per_case():
    import tempfile

    tmp = Path(tempfile.mkdtemp(prefix="ceg-deps-"))
    agent_dir = tmp / "agent"
    agent_dir.mkdir()
    (agent_dir / "main.py").write_text(
        DEPS_AGENT_SOURCE, encoding="utf-8"
    )
    cases = [{"id": "c1", "prompt": "p1"}, {"id": "c2", "prompt": "p2"}]
    run_dir = tmp / "run"
    record_cases(
        agent_dir,
        run_dir,
        cases,
        python=sys.executable,
        env={"CEG_MOCK_MODE": "replay"},
        timeout=30,
    )
    for cid in ("c1", "c2"):
        res = json.loads((run_dir / cid / "result.json").read_text(encoding="utf-8"))
        # 未显式给 deps-dir 时，逐 case 默认落到各自的子目录
        assert res["final_answer"]["text"] == str(run_dir.resolve() / cid)
        assert res["mock_mode"] == "replay"


def test_cli_record_passes_mock_env():
    import tempfile

    tmp = Path(tempfile.mkdtemp(prefix="ceg-deps-"))
    agent_dir = tmp / "agent"
    agent_dir.mkdir()
    (agent_dir / "main.py").write_text(DEPS_AGENT_SOURCE, encoding="utf-8")
    run_dir = tmp / "run"
    deps_dir = tmp / "mydeps"

    buf = io.StringIO()
    with redirect_stdout(buf):
        code = cli.main(
            [
                "record",
                "--agent",
                str(agent_dir),
                "--out",
                str(run_dir),
                "--python",
                sys.executable,
                "--mock-mode",
                "replay",
                "--deps-dir",
                str(deps_dir),
            ]
        )
    assert code == 0
    res = json.loads((run_dir / "result.json").read_text(encoding="utf-8"))
    assert res["final_answer"]["text"] == str(deps_dir)
    assert res["mock_mode"] == "replay"


# 卡死 Agent：写一行协议后长眠，且**不关闭 stdout**（模拟持有管道的挂起）。
HANG_AGENT_SOURCE = '''\
import json
import sys
import time

sys.stdout.write(json.dumps({
    "type": "span", "id": "s1", "name": "x", "kind": "LLM",
    "start_ms": 0, "duration_ms": 1, "attributes": {},
}) + "\\n")
sys.stdout.flush()
time.sleep(3600)
'''


def test_record_agent_times_out_on_hung_agent():
    """回归：Agent 挂起且不关 stdout 时，超时看门狗必须及时中断（此前会无限阻塞）。"""
    import tempfile

    tmp = Path(tempfile.mkdtemp(prefix="ceg-hang-"))
    agent_dir = tmp / "agent"
    agent_dir.mkdir()
    (agent_dir / "main.py").write_text(HANG_AGENT_SOURCE, encoding="utf-8")

    t0 = time.time()
    try:
        record_agent(agent_dir, tmp / "run", python=sys.executable, timeout=1)
        assert False, "应抛 RecordError（超时）"
    except RecordError:
        pass
    elapsed = time.time() - t0
    assert elapsed < 20, f"超时应及时触发，实际耗时 {elapsed:.1f}s（疑似仍会挂起）"


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    print(f"录制生产链测试全部通过 ✅（{len(tests)} 项）")


if __name__ == "__main__":
    main()
