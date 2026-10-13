"""Cegueira 回放引擎：录制代理 + 回放 mock + 请求指纹 + 录制会话 + 工具 mock。

## 为什么是惰性导出（PEP 562）

历史版本在包顶层 eager import 了全部子模块，其中 `session` / `mock` / `recorder`
依赖第三方 `yaml`。后果是：**任何一句 `from python.replay import protocol` 都会
连带拉起 yaml**。而 `protocol` 与 `otel` 是给用户 Agent 的**零依赖埋点**用的——
用户 Agent 的隔离 venv 里未必装了 yaml，于是「只想发个 span」的 Agent 会因为
一句与它无关的 import 而崩溃。

改为 `__getattr__` 惰性解析后：

- `from python.replay import protocol` → 只加载 protocol（json/os/sys/threading/time），
  零第三方依赖；
- `from python.replay import MockRegistry` → 用到时才加载 mock（此时才需要 yaml）。

对既有调用方完全透明（同名同型），只是加载时机推迟。
"""
from __future__ import annotations

import importlib
from typing import TYPE_CHECKING

# 名称 → (子模块, 属性名)。键集合即本包对外导出面。
_EXPORTS = {
    "fingerprint": ("fingerprint", "fingerprint"),
    "FakeLLMHandler": ("fakellm", "FakeLLMHandler"),
    "RecorderHandler": ("recorder", "RecorderHandler"),
    "Recording": ("recorder", "Recording"),
    "serve_recorder": ("recorder", "serve_recorder"),
    "ReplayerHandler": ("replayer", "ReplayerHandler"),
    "RecordingSession": ("session", "RecordingSession"),
    "RecordedRun": ("session", "RecordedRun"),
    "MockDB": ("mock", "MockDB"),
    "MockFile": ("mock", "MockFile"),
    "MockHttp": ("mock", "MockHttp"),
    "MockMissError": ("mock", "MockMissError"),
    "MockRegistry": ("mock", "MockRegistry"),
}

__all__ = list(_EXPORTS)


def __getattr__(name: str):
    """惰性导入导出名；未知名按惯例抛 AttributeError。"""
    target = _EXPORTS.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module_name, attr = target
    module = importlib.import_module(f".{module_name}", __name__)
    return getattr(module, attr)


if TYPE_CHECKING:  # 仅供类型检查器看到真实符号，运行时不执行
    from .fingerprint import fingerprint
    from .fakellm import FakeLLMHandler
    from .recorder import RecorderHandler, Recording, serve_recorder
    from .replayer import ReplayerHandler
    from .session import RecordedRun, RecordingSession
    from .mock import MockDB, MockFile, MockHttp, MockMissError, MockRegistry
