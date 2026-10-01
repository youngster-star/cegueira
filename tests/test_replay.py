"""P0-3 验收：录制回放确定性验证（P0 最高风险假设）。"""
import json
import os
import subprocess
import sys
import threading
from http.server import HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from python.replay.fakellm import FakeLLMHandler  # noqa: E402
from python.replay.recorder import RecorderHandler, Recording  # noqa: E402
from python.replay.replayer import ReplayerHandler  # noqa: E402

RECORDING_PATH = ROOT / "recordings" / "p0-test.json"
AGENT = ROOT / "fixtures" / "echo-agent" / "main.py"


def _serve(handler_cls, port, **attrs):
    server = HTTPServer(("127.0.0.1", port), handler_cls)
    for k, v in attrs.items():
        setattr(handler_cls, k, v)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def _run_agent(llm_url, prompt="hello"):
    env = os.environ.copy()
    env["LLM_URL"] = llm_url
    r = subprocess.run(
        [sys.executable, str(AGENT), prompt],
        capture_output=True, text=True, encoding="utf-8", env=env, timeout=30,
    )
    assert r.returncode == 0, f"Agent 失败: {r.stderr}"
    return r.stdout.strip()


def main():
    servers = []

    # 1. 非确定性 fake LLM
    servers.append(_serve(FakeLLMHandler, 9000))

    # 2. 录制代理
    recording = Recording()
    servers.append(_serve(
        RecorderHandler, 8000,
        recording=recording, upstream="http://127.0.0.1:9000",
    ))

    # 3. 录制：跑 Agent 一次
    trace1 = _run_agent("http://127.0.0.1:8000/v1/chat/completions")
    RECORDING_PATH.parent.mkdir(parents=True, exist_ok=True)
    recording.save(RECORDING_PATH)
    print(f"  录制轨迹: {trace1}")

    # 4. 回放 mock
    records = json.loads(RECORDING_PATH.read_text(encoding="utf-8"))
    servers.append(_serve(ReplayerHandler, 8001, records=records))

    # 5. 回放：跑 Agent 两次
    trace2 = _run_agent("http://127.0.0.1:8001/v1/chat/completions")
    trace3 = _run_agent("http://127.0.0.1:8001/v1/chat/completions")
    print(f"  回放轨迹1: {trace2}")
    print(f"  回放轨迹2: {trace3}")

    # 6. 断言
    assert trace2 == trace3, "❌ 回放两次结果不一致，确定性被破坏"
    ans1 = json.loads(trace1)["answer"]
    ans2 = json.loads(trace2)["answer"]
    assert ans1 == ans2, "❌ 回放未命中录制响应"

    for s in servers:
        s.shutdown()
    print("P0-3 录制回放确定性通过 ✅")


if __name__ == "__main__":
    main()
