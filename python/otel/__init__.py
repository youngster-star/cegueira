"""Cegueira 轻量 OTel GenAI trace 采集（零第三方依赖）。

对应 docs/开发文档.md §9.2「OTel GenAI 预埋 SDK」。用途：用户 Agent 通过本 SDK
埋点，自动发出 llm / tool / retrieval span，供评分引擎的 L2 轨迹信号消费，
替代重量级 opentelemetry 全家桶。
"""
from .collector import TraceCollector, trace_span
from .span import (
    AGENT,
    CHAIN,
    INTERNAL,
    LLM,
    RETRIEVAL,
    TOOL,
    Span,
)

__all__ = [
    "Span",
    "TraceCollector",
    "trace_span",
    "LLM",
    "TOOL",
    "RETRIEVAL",
    "CHAIN",
    "AGENT",
    "INTERNAL",
]
