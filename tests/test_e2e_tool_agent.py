"""P2 端到端验收：依赖外部 HTTP + SQLite + 文件的 Agent 无副作用、确定性地回放。

链路：fake 外部 API + 非确定 fake LLM + 录制代理 → 录制（真实执行外部依赖）
→ 关闭外部 API（模拟断网）→ 回放 mock + 工具 mock 桩 → 回放两次 → 断言一致。

核心验证点（对应 docs/stages/P2-工具调用.md 任务 1 验收）：
一个依赖数据库 + 外部 API 的 Agent 可无副作用回放；回放未触真实网络。
"""
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from python.replay.fakellm import FakeLLMHandler  # noqa: E402
from python.replay.recorder import RecorderHandler, Recording  # noqa: E402
from python.replay.replayer import ReplayerHandler  # noqa: E402

AGENT = ROOT / "fixtures" / "tool-agent" / "main.py"
RUN_DIR = ROOT / "recordings" / "tool-agent"
LLM_JSON = RUN_DIR / "llm.json"


class FakeExternalAPI(BaseHTTPRequestHandler):
    """模拟外部搜索 API，返回固定 JSON。回放时它会被关闭以验证断网。"""

    def do_GET(self):
        data = b'{"results": ["RAG is Retrieval-Augmented Generation"]}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


def _serve(handler_cls, port, **attrs):
    server = HTTPServer(("127.0.0.1", port), handler_cls)
    for k, v in attrs.items():
        setattr(handler_cls, k, v)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def _run_agent(mode, llm_url, api_url, deps_dir, sandbox):
    env = os.environ.copy()
    env.update(
        {
            "CEG_MOCK_MODE": mode,
            "LLM_URL": llm_url,
            "CEG_EXTERNAL_API": api_url,
            "CEG_DEPS_DIR": str(deps_dir),
            "CEG_SANDBOX": str(sandbox),
        }
    )
    r = subprocess.run(
        [sys.executable, str(AGENT)],
        capture_output=True, text=True, encoding="utf-8", env=env, timeout=60,
    )
    assert r.returncode == 0, f"Agent 失败: {r.stderr}"
    return json.loads(r.stdout.strip().splitlines()[-1])


def main():
    servers = []
    try:
        # 1. 非确定 fake LLM + 录制代理 + 外部 API
        servers.append(_serve(FakeLLMHandler, 9000))
        recording = Recording()
        servers.append(_serve(
            RecorderHandler, 8000,
            recording=recording, upstream="http://127.0.0.1:9000",
        ))
        external = _serve(FakeExternalAPI, 9001)
        servers.append(external)

        RUN_DIR.mkdir(parents=True, exist_ok=True)

        # 2. 录制（真实执行外部依赖）
        trace1 = _run_agent(
            "record",
            "http://127.0.0.1:8000/v1/chat/completions",
            "http://127.0.0.1:9001/search",
            RUN_DIR,
            RUN_DIR / "sandbox-record",
        )
        recording.save(LLM_JSON)
        print(f"  录制: doc={trace1['doc']!r} api={trace1['api'][:20]!r}... answer={trace1['answer']!r}")

        # 3. 关闭外部 API（模拟断网，回放若触网即失败）
        external.shutdown()
        servers.remove(external)

        # 4. 回放 mock + 工具 mock 桩，回放两次
        records = json.loads(LLM_JSON.read_text(encoding="utf-8"))
        servers.append(_serve(ReplayerHandler, 8001, records=records))

        trace2 = _run_agent(
            "replay",
            "http://127.0.0.1:8001/v1/chat/completions",
            "http://127.0.0.1:9001/search",
            RUN_DIR,
            RUN_DIR / "sandbox-replay",
        )
        trace3 = _run_agent(
            "replay",
            "http://127.0.0.1:8001/v1/chat/completions",
            "http://127.0.0.1:9001/search",
            RUN_DIR,
            RUN_DIR / "sandbox-replay-2",
        )
        print(f"  回放1: doc={trace2['doc']!r} api={trace2['api'][:20]!r}... answer={trace2['answer']!r}")
        print(f"  回放2: doc={trace3['doc']!r} api={trace3['api'][:20]!r}... answer={trace3['answer']!r}")

        # 5. 断言：两次回放一致，且与录制一致（确定性 + 无副作用）
        assert trace2 == trace3, "❌ 两次回放结果不一致，确定性被破坏"
        assert trace1["doc"] == trace2["doc"], "❌ doc 回放不一致"
        assert trace1["api"] == trace2["api"], "❌ api 回放不一致"
        assert trace1["answer"] == trace2["answer"], "❌ answer 回放不一致"

        # 6. 文件沙箱隔离：回放写文件落在沙箱内
        sandbox_cache = RUN_DIR / "sandbox-replay" / "cache" / "result.txt"
        assert sandbox_cache.exists(), "❌ 回放未写入沙箱缓存文件"

        print("P2 端到端：含外部依赖 Agent 无副作用回放通过 ✅")
    finally:
        for s in servers:
            try:
                s.shutdown()
            except Exception:
                pass


if __name__ == "__main__":
    main()
