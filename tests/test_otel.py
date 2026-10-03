"""OTel trace 采集器（python/otel）测试。

覆盖：span 生命周期、嵌套 parent 关系、JSON Lines 导出、非法 kind 报错。
零第三方依赖，纯标准库。
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from python.otel import (  # noqa: E402
    AGENT,
    INTERNAL,
    LLM,
    RETRIEVAL,
    TOOL,
    TraceCollector,
    trace_span,
)
from python.otel.span import Span  # noqa: E402


def test_span_lifecycle_and_attributes():
    c = TraceCollector(trace_id="trace-1")
    with trace_span(c, "chat.completion", LLM, model="gpt-4") as span:
        span.set_attribute("prompt_tokens", 100)
        span.add_event("first_token")
    assert span.end_ns is not None
    assert span.duration_ms is not None and span.duration_ms >= 0
    d = span.to_dict()
    assert d["name"] == "chat.completion"
    assert d["kind"] == "LLM"
    assert d["trace_id"] == "trace-1"
    assert d["attributes"]["model"] == "gpt-4"
    assert d["events"][0]["name"] == "first_token"
    assert d["status"] == "ok"


def test_nested_spans_auto_parent():
    c = TraceCollector(trace_id="trace-2")
    with trace_span(c, "agent.run", AGENT) as outer:
        with trace_span(c, "tool.search", TOOL) as inner:
            with trace_span(c, "retrieval.query", RETRIEVAL) as leaf:
                pass
    assert inner.parent_span_id == outer.span_id
    assert leaf.parent_span_id == inner.span_id
    assert outer.parent_span_id is None


def test_export_jsonl_matches_spans():
    c = TraceCollector(trace_id="trace-3")
    with trace_span(c, "a", LLM):
        pass
    with trace_span(c, "b", TOOL):
        pass
    lines = c.export_jsonl().splitlines()
    assert len(lines) == 2
    assert json.loads(lines[0])["name"] == "a"
    assert json.loads(lines[1])["kind"] == "TOOL"


def test_invalid_kind_raises():
    try:
        Span(name="x", kind="BOGUS", trace_id="t", span_id="s")
        assert False, "应抛 ValueError"
    except ValueError:
        pass


def test_default_trace_id_generated():
    c1 = TraceCollector()
    c2 = TraceCollector()
    assert c1.trace_id and c2.trace_id
    assert c1.trace_id != c2.trace_id


def test_span_id_sequential():
    c = TraceCollector(trace_id="t")
    with trace_span(c, "a", INTERNAL):
        pass
    with trace_span(c, "b", INTERNAL):
        pass
    assert c.spans[0].span_id == "span-1"
    assert c.spans[1].span_id == "span-2"


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    print(f"otel 全部测试通过 ✅（{len(tests)} 项）")


if __name__ == "__main__":
    main()
