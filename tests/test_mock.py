"""工具 mock 框架（MockHttp/MockDB/MockFile/MockRegistry）单元测试。

覆盖 P2 任务 1：外部依赖录制→回放替换、未命中即报错、写操作无副作用、
文件沙箱隔离、注册表持久化往返、非法 mode 校验。
"""
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from python.replay.mock import (  # noqa: E402
    MockDB,
    MockFile,
    MockHttp,
    MockMissError,
    MockRegistry,
)


def _tmpdir():
    return Path(tempfile.mkdtemp(prefix="ceg-mock-"))


# ---- MockHttp ----


def test_http_record_then_replay_returns_same_body():
    rec = MockHttp(mode="record")
    # 用本地 fake 服务模拟外部依赖（避免真实外网）
    from http.server import BaseHTTPRequestHandler, HTTPServer
    import threading

    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            data = b'{"v": 42}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{srv.server_port}/api/data"
        recorded = rec.fetch(url, method="GET")
        # 转回放
        replay = MockHttp.from_dict(rec.to_dict(), mode="replay")
        assert replay.fetch(url, method="GET") == recorded
        assert recorded == b'{"v": 42}'
    finally:
        srv.shutdown()


def test_http_replay_miss_raises():
    r = MockHttp(mode="replay")
    try:
        r.fetch("http://example.invalid/never", method="GET")
        assert False, "应抛 MockMissError"
    except MockMissError:
        pass


def test_http_invalid_mode_raises():
    try:
        MockHttp(mode="bad")
        assert False, "应抛 ValueError"
    except ValueError:
        pass


# ---- MockDB ----


def test_db_read_record_then_replay():
    rec = MockDB(mode="record")
    rec.execute("CREATE TABLE t (id INTEGER, name TEXT)")
    rec.execute("INSERT INTO t VALUES (1, 'a'), (2, 'b')")
    rows = rec.execute("SELECT * FROM t WHERE id > ?", (0,))
    assert rows == [(1, "a"), (2, "b")]

    replay = MockDB.from_dict(rec.to_dict(), mode="replay")
    # 回放读结果来自录制记录（确定性）
    assert replay.execute("SELECT * FROM t WHERE id > ?", (0,)) == rows


def test_db_replay_miss_raises():
    r = MockDB(mode="replay")
    try:
        r.execute("SELECT * FROM missing_table")
        assert False, "应抛 MockMissError"
    except MockMissError:
        pass


def test_db_write_replay_is_side_effect_free():
    rec = MockDB(mode="record")
    rec.execute("CREATE TABLE t (id INTEGER)")
    rec.execute("INSERT INTO t VALUES (1)")
    recorded_count = rec.execute("SELECT COUNT(*) FROM t")  # 录制读结果 [(1,)]

    replay = MockDB.from_dict(rec.to_dict(), mode="replay")
    replay.execute("CREATE TABLE t (id INTEGER)")  # 回放重建 schema
    replay.execute("INSERT INTO t VALUES (2)")  # 回放写：执行到隔离内存库
    # 读结果来自录制记录（确定性），不受回放写操作影响
    assert replay.execute("SELECT COUNT(*) FROM t") == recorded_count


def test_db_invalid_mode_raises():
    try:
        MockDB(mode="x")
        assert False, "应抛 ValueError"
    except ValueError:
        pass


# ---- MockFile ----


def test_file_sandbox_isolates_absolute_path():
    sandbox = _tmpdir()
    f = MockFile(sandbox)
    # 写一个「看起来像绝对路径」的文件，实际落在沙箱内
    f.write_text("/etc/passwd", "not-real")
    assert (sandbox / "etc" / "passwd").read_text(encoding="utf-8") == "not-real"
    # 真实系统路径未被污染
    assert not Path("/etc/passwd").exists() or "not-real" not in Path("/etc/passwd").read_text(encoding="utf-8", errors="ignore")


def test_file_sandbox_relative_path():
    sandbox = _tmpdir()
    f = MockFile(sandbox)
    f.write_text("out/result.txt", "hello")
    assert (sandbox / "out" / "result.txt").read_text(encoding="utf-8") == "hello"


# ---- MockRegistry ----


def test_registry_save_load_roundtrip():
    reg = MockRegistry(mode="record", sandbox_dir=_tmpdir() / "sandbox")
    reg.db.execute("CREATE TABLE t (id INTEGER)")
    reg.db.execute("INSERT INTO t VALUES (7)")
    rows = reg.db.execute("SELECT * FROM t")
    d = _tmpdir()
    reg.save(d)

    loaded = MockRegistry.load(d, sandbox_dir=_tmpdir() / "sandbox2")
    assert loaded.mode == "replay"
    assert loaded.db.execute("SELECT * FROM t") == rows


def test_registry_load_missing_raises():
    try:
        MockRegistry.load(_tmpdir())
        assert False, "应抛 MockMissError"
    except MockMissError:
        pass


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    print(f"mock 单元测试全部通过 ✅（{len(tests)} 项）")


if __name__ == "__main__":
    main()
