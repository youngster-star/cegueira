"""RecordingSession 三类产物（http.yaml / trace.json / tool_io.log）序列化与反序列化测试。

覆盖 P1 任务 2「录制回放产品化」：三类产物可落盘、可读回、往返一致，
空产物与非法文件边界也需正确处理。
"""
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from python.replay.session import (  # noqa: E402
    RecordingSession,
    read_http_yaml,
    read_tool_io,
    read_trace_json,
    write_http_yaml,
    write_tool_io,
    write_trace_json,
)


def _tmpdir():
    return Path(tempfile.mkdtemp(prefix="ceg-session-"))


def test_http_yaml_roundtrip():
    s = RecordingSession(run_id="r1")
    s.add_http("POST", "llm", "/v1/chat", b'{"messages":[{"content":"hi"}]}', 200, b'{"ok":true}')
    d = _tmpdir()
    s.save(d)
    records = read_http_yaml(d / "http.yaml")
    assert len(records) == 1
    (rec,) = records.values()
    assert rec["request"]["method"] == "POST"
    assert rec["response"]["status"] == 200
    assert rec["response"]["body"] == '{"ok":true}'


def test_http_yaml_dynamic_fields_same_fingerprint():
    s = RecordingSession()
    s.add_http("POST", "llm", "/v1/chat", b'{"messages":[{"id":"a","content":"hi"}],"timestamp":1}', 200, b"x")
    s.add_http("POST", "llm", "/v1/chat", b'{"messages":[{"id":"b","content":"hi"}],"timestamp":2}', 200, b"y")
    # 动态字段不同 → 同指纹 → 后写覆盖前写，仅一条
    assert len(s.http_records) == 1


def test_trace_json_roundtrip():
    s = RecordingSession(run_id="r9")
    p = s.add_span("llm.call", "llm", 0.0, 900.0, model="fake")
    s.add_span("tool.call", "tool", 10.0, 120.0, parent_id=p, tool_name="search")
    d = _tmpdir()
    s.save(d)
    payload = read_trace_json(d / "trace.json")
    assert payload["run_id"] == "r9"
    assert len(payload["spans"]) == 2
    assert payload["spans"][1]["parent_id"] == p


def test_tool_io_roundtrip():
    s = RecordingSession()
    s.add_tool_io("search", {"query": "rag"}, [{"id": "d1"}], True, 12.0)
    s.add_tool_io("search", {"query": "rag"}, None, False, 8.0)
    d = _tmpdir()
    s.save(d)
    rows = read_tool_io(d / "tool_io.log")
    assert len(rows) == 2
    assert rows[0]["tool"] == "search"
    assert rows[1]["ok"] is False


def test_empty_tool_io_reads_as_empty_list():
    d = _tmpdir()
    write_tool_io(d / "tool_io.log", [])
    assert read_tool_io(d / "tool_io.log") == []


def test_save_creates_three_files():
    s = RecordingSession(run_id="r3")
    s.add_http("POST", "llm", "/x", b"{}", 200, b"{}")
    s.add_span("s", "llm", 0, 1)
    s.add_tool_io("t", {}, {}, True, 1)
    d = _tmpdir()
    run = s.save(d)
    for p in (run.http_path, run.trace_path, run.tool_io_path):
        assert p.exists(), f"{p.name} 未生成"
    assert run.run_id == "r3"


def test_read_http_yaml_invalid_file_raises():
    d = _tmpdir()
    p = d / "bad.yaml"
    p.write_text("just a string", encoding="utf-8")
    try:
        read_http_yaml(p)
        assert False, "应抛错"
    except ValueError:
        pass


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    print(f"session 单元测试全部通过 ✅（{len(tests)} 项）")


if __name__ == "__main__":
    main()
