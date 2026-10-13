"""venv 幂等与依赖安装标记（python/runtime/ensure.py）测试。

回归点：pip 安装失败后 venv 目录已“有效”，旧实现下次直接复用它，
把一次失败永久掩盖、依赖永不重装。修复后以 `.ceg-deps-ok` 标记
「依赖确实装成功」，缺失则重试。
"""
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import python.runtime.ensure as ensure  # noqa: E402


def _fake_run_factory(vdir: Path, calls: list):
    def fake_run(cmd, check=False, **kwargs):
        calls.append(list(cmd))
        # 模拟 `python -m venv <dir>` 的产出
        if len(cmd) >= 3 and cmd[1] == "-m" and cmd[2] == "venv":
            vdir.mkdir(parents=True, exist_ok=True)
            (vdir / "pyvenv.cfg").write_text("", encoding="utf-8")
            ensure.venv_python(vdir).parent.mkdir(parents=True, exist_ok=True)
            ensure.venv_python(vdir).write_text("", encoding="utf-8")
        return None

    return fake_run


def test_ensure_venv_marks_deps_and_reinstalls_when_missing():
    tmp = Path(tempfile.mkdtemp(prefix="ceg-ensure-"))
    agent = tmp / "agent"
    agent.mkdir()
    (agent / "requirements.txt").write_text("somepkg\n", encoding="utf-8")
    vdir = tmp / "venv"

    calls: list = []
    orig = ensure.subprocess.run
    ensure.subprocess.run = _fake_run_factory(vdir, calls)
    try:
        r1 = ensure.ensure_venv(agent, venv_dir=vdir)
        assert r1 == vdir
        assert (vdir / ensure.DEPS_MARKER).exists(), "装成功应写标记"
        n1 = len(calls)

        # 第二次：marker 在 → 不重建、不重装
        ensure.ensure_venv(agent, venv_dir=vdir)
        assert len(calls) == n1, "已有标记时不应重复安装"

        # 删除标记（模拟 pip 失败后遗留的 venv）→ 应重装
        (vdir / ensure.DEPS_MARKER).unlink()
        ensure.ensure_venv(agent, venv_dir=vdir)
        assert len(calls) == n1 + 1, "标记缺失时应重试安装"
    finally:
        ensure.subprocess.run = orig


def test_ensure_venv_without_requirements_skips_pip():
    tmp = Path(tempfile.mkdtemp(prefix="ceg-ensure-"))
    agent = tmp / "agent"
    agent.mkdir()  # 无 requirements.txt
    vdir = tmp / "venv"

    calls: list = []
    orig = ensure.subprocess.run
    ensure.subprocess.run = _fake_run_factory(vdir, calls)
    try:
        ensure.ensure_venv(agent, venv_dir=vdir)
        # 只有建 venv 一次，没有 pip install
        assert all(not (len(c) >= 3 and c[2] == "pip") for c in calls), calls
        # 无依赖时不要求标记，二次调用直接复用
        n = len(calls)
        ensure.ensure_venv(agent, venv_dir=vdir)
        assert len(calls) == n
    finally:
        ensure.subprocess.run = orig


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    print(f"ensure 测试全部通过 ✅（{len(tests)} 项）")


if __name__ == "__main__":
    main()
