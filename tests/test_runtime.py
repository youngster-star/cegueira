"""P0-2 验收测试：venv 引导幂等 + Agent 拉起 + stdout/stderr 分离。"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from python.runtime.ensure import ensure_venv, is_valid_venv  # noqa: E402
from python.runtime.spawn import spawn_agent  # noqa: E402

FIXTURES = ROOT / "fixtures"


def test_ensure_venv_idempotent():
    agent = FIXTURES / "hello-agent"
    v1 = ensure_venv(agent)
    assert is_valid_venv(v1), "venv 创建失败"
    v2 = ensure_venv(agent)
    assert v1 == v2, "幂等性被破坏：两次 ensure 结果不一致"
    print(f"  ✓ venv 幂等: {v1}")


def test_spawn_agent_separates_streams():
    agent = FIXTURES / "hello-agent"
    proc = spawn_agent(agent, entry="main.py")
    out, err = proc.communicate(timeout=30)
    assert proc.returncode == 0, f"Agent 退出码非 0: {proc.returncode}"
    lines = [json.loads(l) for l in out.strip().splitlines() if l.strip()]
    assert any(m["type"] == "hello" and m["ok"] for m in lines), "未收到 hello 消息"
    assert "hello-agent started" in err, "stderr 日志未正确分离"
    print("  ✓ stdout 走协议、stderr 走日志，分离正确")


if __name__ == "__main__":
    test_ensure_venv_idempotent()
    test_spawn_agent_separates_streams()
    print("P0-2 全部通过 ✅")
