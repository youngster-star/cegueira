"""为每个用户 Agent 创建独立 venv，幂等、隔离。

设计原则（见 docs/stages/P0-Spike.md 任务 2）：
- 隔离：每个用户 Agent 使用自己的 venv，绝不共享，避免依赖串味。
- 幂等：重复调用不重建已有环境，结果一致。
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

# 默认 venv 目录名
DEFAULT_VENV_DIR = ".venv"


def venv_python(venv_dir: Path) -> Path:
    """返回 venv 内 python 可执行文件路径（跨平台）。"""
    if sys.platform == "win32":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def is_valid_venv(venv_dir: Path) -> bool:
    """判断目录是否为可用 venv。"""
    return (venv_dir / "pyvenv.cfg").exists() and venv_python(venv_dir).exists()


def ensure_venv(agent_dir: Path, venv_dir: Path | None = None) -> Path:
    """确保 agent_dir 下存在可用 venv；缺失则创建并安装依赖。

    参数:
        agent_dir: 用户 Agent 项目目录（含 requirements.txt）。
        venv_dir: 可选，指定 venv 位置；默认 agent_dir/.venv。

    返回:
        venv 目录路径。

    异常:
        subprocess.CalledProcessError: pip 安装失败时抛出（由上层转为可诊断错误）。
    """
    vdir = venv_dir or (agent_dir / DEFAULT_VENV_DIR)

    if is_valid_venv(vdir):
        return vdir

    vdir.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, "-m", "venv", str(vdir)], check=True)

    req = agent_dir / "requirements.txt"
    if req.exists():
        subprocess.run(
            [str(venv_python(vdir)), "-m", "pip", "install", "-r", str(req)],
            check=True,
        )

    return vdir


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
    ready = ensure_venv(target)
    print(f"venv ready: {ready}")
