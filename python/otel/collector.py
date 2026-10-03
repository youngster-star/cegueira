"""TraceCollector：采集 span，导出 JSON Lines（零第三方依赖）。"""
from __future__ import annotations

import contextvars
import json
import uuid
from contextlib import contextmanager
from typing import Iterator

from .span import INTERNAL, Span

# 当前活跃 span（跨函数传递，支持嵌套时自动设 parent）
_current_span: contextvars.ContextVar[Span | None] = contextvars.ContextVar(
    "cegueira_current_span", default=None
)


class TraceCollector:
    """一次 trace 的 span 集合。"""

    def __init__(self, trace_id: str | None = None):
        self.trace_id = trace_id or uuid.uuid4().hex
        self.spans: list[Span] = []

    def start_span(self, name: str, kind: str = INTERNAL, **attrs) -> Span:
        parent = _current_span.get()
        span = Span(
            name=name,
            kind=kind,
            trace_id=self.trace_id,
            span_id=f"span-{len(self.spans) + 1}",
            parent_span_id=parent.span_id if parent is not None else None,
            attributes=dict(attrs),
        )
        self.spans.append(span)
        return span

    def export_list(self) -> list[dict]:
        return [s.to_dict() for s in self.spans]

    def export_jsonl(self) -> str:
        lines = [json.dumps(s.to_dict(), ensure_ascii=False) for s in self.spans]
        return "\n".join(lines)


@contextmanager
def trace_span(
    collector: TraceCollector, name: str, kind: str = INTERNAL, **attrs
) -> Iterator[Span]:
    """上下文管理器：自动 start/end，嵌套时自动设 parent。"""
    span = collector.start_span(name, kind, **attrs)
    token = _current_span.set(span)
    try:
        yield span
    finally:
        span.end()
        _current_span.reset(token)
