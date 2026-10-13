"""Agent → CLI 的协议通道（`CEG_PROTOCOL=1` 门控）。

## 为什么需要它

`trace.json` 与 `tool_io.log` **今天没有任何生产者**——`RecordingSession` 有写入
方法，但没有任何代码调用它们（`python/otel/collector.py` 同样是零调用方）。
用户 Agent 跑在**独立进程**里，它的埋点结果必须回传给 CLI 才能落盘。

## 为什么走 stdout，且必须门控

沿既有约定（docs/常见错误与坑.md §1）：**stdout 只走协议，日志一律走 stderr**。
Agent 已经用 stdout 输出 `{"type": "trace", ...}`，这里是同一根管道的扩展。

但 `mock.py` / `otel` 是**库代码**，会被 `import` 进任意上下文——包括单元测试。
若它们无条件往 stdout 写，`tests/test_mock.py` 的断言输出会被协议行污染。
因此所有发射都由 `CEG_PROTOCOL=1` 门控，**并且该变量只由 CLI 注入**：

    现有测试不设该变量 → 库在被 import 与调用时完全静默 → 测试零改动

## 协议行（每行一个 JSON 对象，`type` 字段区分）

    {"type": "span",    "id", "parent_id", "name", "kind", "start_ms", "duration_ms", "attributes"}
    {"type": "tool_io", "tool", "input", "output", "ok", "latency_ms", "source"}
    {"type": "trace",   ...}   ← Agent 自己的最终输出（既有约定，含 final_answer）

`source` 区分两类工具调用，**必须区分**：

- `"agent"` —— Agent 自己声明的工具（`retrieve` / `chunk` / `index` 之类）。
  这是 S_process 的计量单位：一次 `retrieve()` 内部可能打 3 个外部调用，
  但用户眼里那是**一步**。
- `"dep"`   —— MockRegistry 记录的外部依赖调用（`http.fetch` / `db.execute` / …）。
  属于诊断与防作弊素材，**不参与**步数、冗余率、成功率——否则步数按外部
  调用数膨胀，`tool_call_in` 白名单也会对不上（契约里写的是 Agent 级工具名）。

CLI 按 `source` 分派到 `tool_io.log` 与 `dep_io.log` 两个文件。
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time

TYPE_SPAN = "span"
TYPE_TOOL_IO = "tool_io"
TYPE_TRACE = "trace"

SOURCE_AGENT = "agent"
SOURCE_DEP = "dep"

# 协议行的**并发**必须串行化：MockHttp/MockDB 可能被 Agent 的工作线程调用，
# 而 TraceCollector 由主线程调用。两个线程同时写同一根管道会交错出半个 JSON
# 对象，读端按行解析时得到一行坏数据——而坏数据按约定是要报错中断的。
_LOCK = threading.Lock()
_stream = None


def enabled() -> bool:
    """是否处于协议模式。

    逐次读环境变量而非在 import 时定值：测试可以在进程内 `monkeypatch` 后
    立刻生效，不必重启解释器。
    """
    return os.environ.get("CEG_PROTOCOL") == "1"


def set_stream(stream) -> None:
    """重定向协议输出（测试用）；传 None 恢复 stdout。"""
    global _stream
    _stream = stream


def emit(record: dict) -> bool:
    """写出一行协议记录。未启用时静默返回 False（不报错、不写任何东西）。"""
    if not enabled():
        return False
    line = json.dumps(record, ensure_ascii=False, default=str)
    with _LOCK:
        out = _stream if _stream is not None else sys.stdout
        out.write(line + "\n")
        out.flush()
    return True


def emit_span(
    span_id: str,
    name: str,
    kind: str,
    start_ms: float,
    duration_ms: float,
    parent_id: str | None = None,
    attributes: dict | None = None,
) -> bool:
    """发射一条 span 记录。字段名与 `RecordingSession.add_span` 逐字对齐。"""
    return emit(
        {
            "type": TYPE_SPAN,
            "id": span_id,
            "parent_id": parent_id,
            "name": name,
            "kind": kind,
            "start_ms": start_ms,
            "duration_ms": duration_ms,
            "attributes": attributes or {},
        }
    )


def emit_tool_io(
    tool: str,
    input_: dict,
    output,
    ok: bool,
    latency_ms: float,
    source: str = SOURCE_AGENT,
) -> bool:
    """发射一条工具调用记录。"""
    return emit(
        {
            "type": TYPE_TOOL_IO,
            "tool": tool,
            "input": input_,
            "output": output,
            "ok": ok,
            "latency_ms": latency_ms,
            "source": source,
        }
    )


class timed_tool:
    """计时并发射的上下文管理器；`ok` 由是否抛异常决定。

    用法::

        with timed_tool("retrieve", {"query": q}) as ctx:
            ctx.result = do_work()
        # 退出时自动 emit_tool_io(..., ok=True/False, latency_ms=实测)

    **未启用协议时也照常计时**（开销只有两次 `perf_counter`），
    这样「开了协议」与「没开协议」的代码路径完全一致，不会出现
    「测的时候好好的，上线一开协议就慢/就错」。

    异常**不被吞掉**：记录 ok=False 后原样抛出，调用方行为不变。
    """

    def __init__(self, tool: str, input_: dict, source: str = SOURCE_AGENT):
        self.tool = tool
        self.input = input_
        self.source = source
        self.result = None
        self._t0 = 0.0

    def __enter__(self) -> "timed_tool":
        self._t0 = time.perf_counter()
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        latency_ms = (time.perf_counter() - self._t0) * 1000.0
        emit_tool_io(
            self.tool,
            self.input,
            None if exc_type is not None else self.result,
            exc_type is None,
            latency_ms,
            self.source,
        )
        return False  # 绝不吞异常
