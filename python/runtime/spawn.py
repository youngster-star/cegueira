"""拉起用户 Agent 子进程，stdout 走协议、stderr 走日志。

设计原则：
- stdout 只承载协议数据（JSON Lines），日志一律走 stderr，
  避免日志污染协议流（见 docs/常见错误与坑.md §1）。
- 通过环境变量注入 HTTP 代理，供录制回放使用。
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from .ensure import ensure_venv, venv_python


def spawn_agent(
    agent_dir: Path,
    entry: str = "main.py",
    env: dict[str, str] | None = None,
) -> subprocess.Popen:
    """启动用户 Agent 子进程。

    参数:
        agent_dir: 用户 Agent 项目目录。
        entry: 入口文件（相对 agent_dir）。
        env: 额外注入的环境变量（如 HTTP_PROXY / HTTPS_PROXY）。

    返回:
        已启动的 Popen 对象（stdout/stderr 均为 PIPE，文本模式，UTF-8）。
    """
    vdir = ensure_venv(agent_dir)
    python = venv_python(vdir)

    child_env = os.environ.copy()
    child_env.setdefault("PYTHONIOENCODING", "utf-8")
    if env:
        child_env.update(env)

    return subprocess.Popen(
        [str(python), entry],
        cwd=str(agent_dir),
        env=child_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
