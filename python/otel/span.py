"""Span 数据结构（简化 OTel GenAI，零第三方依赖）。

对应 docs/开发文档.md §9.2「OTel GenAI 预埋 SDK」：用户 Agent 通过本模块埋点，
自动发出 llm / tool / retrieval span，供评分引擎 L2 轨迹信号消费。
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

# span kind（对齐 docs/开发文档.md §8.2 的 llm / tool / retrieval）
LLM = "LLM"
TOOL = "TOOL"
RETRIEVAL = "RETRIEVAL"
CHAIN = "CHAIN"
AGENT = "AGENT"
INTERNAL = "INTERNAL"

_VALID_KINDS = (LLM, TOOL, RETRIEVAL, CHAIN, AGENT, INTERNAL)


@dataclass
class Span:
    name: str
    kind: str
    trace_id: str
    span_id: str
    parent_span_id: str | None = None
    start_ns: int = field(default_factory=time.time_ns)
    end_ns: int | None = None
    attributes: dict = field(default_factory=dict)
    events: list = field(default_factory=list)
    status: str = "unset"

    def __post_init__(self) -> None:
        if self.kind not in _VALID_KINDS:
            raise ValueError(f"未知 span kind: {self.kind}")

    def end(self, status: str = "ok") -> "Span":
        self.end_ns = time.time_ns()
        self.status = status
        return self

    def set_attribute(self, key: str, value) -> "Span":
        self.attributes[key] = value
        return self

    def add_event(self, name: str, **attrs) -> "Span":
        self.events.append(
            {"name": name, "time_ns": time.time_ns(), "attributes": attrs}
        )
        return self

    @property
    def duration_ms(self) -> float | None:
        if self.end_ns is None:
            return None
        return (self.end_ns - self.start_ns) / 1e6

    def to_dict(self) -> dict:
        return {
            "trace_id": self.trace_id,
            "span_id": self.span_id,
            "parent_span_id": self.parent_span_id,
            "name": self.name,
            "kind": self.kind,
            "start_ns": self.start_ns,
            "end_ns": self.end_ns,
            "duration_ms": self.duration_ms,
            "attributes": self.attributes,
            "events": self.events,
            "status": self.status,
        }
