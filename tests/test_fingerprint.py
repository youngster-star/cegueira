"""fingerprint 模块单元测试：动态字段剔除、嵌套 JSON、数组 body、指纹稳定性。

覆盖 P0 录制回放确定性的关键前提：同一语义请求的指纹必须稳定，
动态字段（timestamp/random/nonce/id/request_id）不得影响指纹。
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from python.replay.fingerprint import (  # noqa: E402
    _strip_dynamic,
    fingerprint,
    normalize_body,
)


def test_normalize_empty_body():
    assert normalize_body(b"") == ""


def test_normalize_non_json_body():
    assert normalize_body(b"plain text body") == "plain text body"
    # 非 UTF-8 字节也能兜底，不抛错
    assert normalize_body(b"\xff\xfe invalid") == "\ufffd\ufffd invalid"


def test_normalize_strips_top_level_dynamic_keys():
    out = normalize_body(b'{"q": "hi", "timestamp": 123, "random": 456}')
    assert '"timestamp"' not in out
    assert '"random"' not in out
    assert '"q"' in out


def test_normalize_strips_all_dynamic_keys():
    body = (
        b'{"q": "hi", "timestamp": 1, "random": 2, "nonce": 3, "id": 4, "request_id": 5}'
    )
    out = normalize_body(body)
    for key in ("timestamp", "random", "nonce", "id", "request_id"):
        assert f'"{key}"' not in out, f"{key} 未被剔除"


def test_normalize_json_array_body():
    # 数组 body（旧实现会抛 TypeError，回归测试）
    out = normalize_body(b'[{"id": "x", "q": "hi"}]')
    assert out == '[{"q": "hi"}]'


def test_normalize_nested_dynamic_fields():
    # 嵌套对象内的动态字段也剔除
    out = normalize_body(b'{"messages": [{"id": "inner", "content": "hi"}], "timestamp": 123}')
    assert "timestamp" not in out
    assert "inner" not in out  # 嵌套 id 被剔除
    assert "content" in out


def test_strip_dynamic_preserves_non_dynamic_structure():
    obj = {"a": 1, "b": [{"id": "x", "keep": "y"}], "id": "top"}
    result = _strip_dynamic(obj)
    assert result == {"a": 1, "b": [{"keep": "y"}]}


def test_fingerprint_stable_against_dynamic_fields():
    a = fingerprint(
        "POST", "llm", "/v1/chat",
        b'{"messages":[{"id":"a","content":"hi"}],"timestamp":1}',
    )
    b = fingerprint(
        "POST", "llm", "/v1/chat",
        b'{"messages":[{"id":"b","content":"hi"}],"timestamp":2}',
    )
    assert a == b, "动态字段不同应得到相同指纹"


def test_fingerprint_differs_on_semantic_change():
    a = fingerprint(
        "POST", "llm", "/v1/chat",
        b'{"messages":[{"id":"a","content":"hi"}]}',
    )
    b = fingerprint(
        "POST", "llm", "/v1/chat",
        b'{"messages":[{"id":"a","content":"bye"}]}',
    )
    assert a != b, "语义不同应得到不同指纹"


def test_fingerprint_differs_on_method_host_path():
    base = (b"{}",)
    f1 = fingerprint("POST", "llm", "/a", b"{}")
    f2 = fingerprint("GET", "llm", "/a", b"{}")
    f3 = fingerprint("POST", "llm", "/b", b"{}")
    f4 = fingerprint("POST", "other", "/a", b"{}")
    assert len({f1, f2, f3, f4}) == 4, "method/host/path 任一不同指纹应不同"


def test_normalize_body_key_order_independent():
    a = normalize_body(b'{"b": 1, "a": 2}')
    b = normalize_body(b'{"a": 2, "b": 1}')
    assert a == b, "键顺序不同应归一化到相同结果"


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    print(f"fingerprint 单元测试全部通过 ✅（{len(tests)} 项）")


if __name__ == "__main__":
    main()
