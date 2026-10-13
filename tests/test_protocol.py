"""协议通道（python/replay/protocol.py）与 `CEG_PROTOCOL` 门控测试。

覆盖 P2/A3：「让 trace.json / tool_io.log 有生产者」。

**门控是这里最要紧的验证点**：mock.py 与 otel 是被 `import` 进任意上下文的
库代码。若它们无条件往 stdout 写协议行，`tests/test_mock.py`、`test_otel.py`
的断言输出会被污染——而且是那种「平时绿、偶尔红」的污染，因为输出量取决于
执行路径。所以必须证明：**不设 CEG_PROTOCOL 时，库完全静默**。
"""
import io
import json
import os
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from python.otel.collector import TraceCollector, trace_span  # noqa: E402
from python.otel.span import LLM, TOOL  # noqa: E402
from python.replay import protocol  # noqa: E402
from python.replay.mock import MockDB, MockFile, MockHttp, MockRegistry  # noqa: E402


class _capture:
    """临时把协议输出重定向到内存缓冲，并强制开关门控。"""

    def __init__(self, enabled: bool):
        self.enabled = enabled
        self.buf = io.StringIO()

    def __enter__(self):
        self._old_env = os.environ.get("CEG_PROTOCOL")
        if self.enabled:
            os.environ["CEG_PROTOCOL"] = "1"
        else:
            os.environ.pop("CEG_PROTOCOL", None)
        protocol.set_stream(self.buf)
        return self

    def __exit__(self, *exc):
        protocol.set_stream(None)
        if self._old_env is None:
            os.environ.pop("CEG_PROTOCOL", None)
        else:
            os.environ["CEG_PROTOCOL"] = self._old_env
        return False

    def lines(self) -> list:
        return [json.loads(x) for x in self.buf.getvalue().splitlines() if x.strip()]


def test_disabled_by_default_writes_nothing():
    """未设 CEG_PROTOCOL 时，emit 静默且不写任何字节。"""
    with _capture(enabled=False) as c:
        assert protocol.enabled() is False
        assert protocol.emit({"type": "x"}) is False
        assert protocol.emit_span("s1", "n", "LLM", 0.0, 1.0) is False
        assert protocol.emit_tool_io("t", {}, None, True, 1.0) is False
    assert c.buf.getvalue() == ""


def test_mock_silent_when_disabled():
    """库代码在门控关闭时完全静默——这是现有测试不被污染的前提。"""
    with _capture(enabled=False) as c:
        db = MockDB(mode="record")
        db.execute("CREATE TABLE t (a INTEGER)")
        db.execute("INSERT INTO t VALUES (1)")
        assert db.execute("SELECT a FROM t") == [(1,)]

        files = MockFile(sandbox_dir=Path(os.environ.get("TEMP", ".")) / "ceg-proto-silent")
        files.write_text("x.txt", "hi")
        assert files.read_text("x.txt") == "hi"
    assert c.buf.getvalue() == "", f"门控关闭时不应有任何输出，实际：{c.buf.getvalue()!r}"


def test_otel_silent_when_disabled():
    with _capture(enabled=False) as c:
        collector = TraceCollector(trace_id="t1")
        with trace_span(collector, "llm.call", LLM, model="fake"):
            pass
    assert c.buf.getvalue() == ""


def test_span_emitted_on_end():
    """span.end() 时发出一条协议记录，字段与 RecordingSession.add_span 对齐。

    记录按 **span 完成顺序**发射，因此嵌套时子 span 先出现、父 span 后出现。
    第一个 span 显式 `end()` 一次，随后 `trace_span` 退出时又会 `end()` 一次——
    非幂等会产生两条重复记录（trace.json 里出现重复 span id），这条测试同时
    锁住 end() 的幂等性。
    """
    with _capture(enabled=True) as c:
        collector = TraceCollector(trace_id="t1")
        with trace_span(collector, "llm.call", LLM, prompt_tokens=10) as span:
            with trace_span(collector, "tool.call", TOOL):
                pass
            span.end()

    rows = c.lines()
    assert len(rows) == 2
    child, parent = rows
    # 子 span：先完成，自动挂到父 span-1 上
    assert child["type"] == "span"
    assert child["name"] == "tool.call"
    assert child["kind"] == "TOOL"
    assert child["id"] == "span-2"
    assert child["parent_id"] == "span-1"
    # 父 span：显式 end() + 上下文退出各一次，但只应产生一条记录
    assert parent["type"] == "span"
    assert parent["name"] == "llm.call"
    assert parent["kind"] == "LLM"
    assert parent["attributes"] == {"prompt_tokens": 10}
    assert parent["id"] == "span-1"
    assert parent["parent_id"] is None
    assert parent["duration_ms"] >= 0


def test_mock_emits_dep_source():
    """MockRegistry 的调用以 source=dep 发射——不计入 Agent 步数。"""
    with _capture(enabled=True) as c:
        db = MockDB(mode="record")
        db.execute("CREATE TABLE t (a INTEGER)")
        db.execute("SELECT a FROM t")

    rows = [r for r in c.lines() if r["type"] == "tool_io"]
    assert len(rows) == 2
    assert all(r["source"] == "dep" for r in rows), rows
    assert rows[0]["tool"] == "db.execute"
    assert rows[0]["ok"] is True
    assert "latency_ms" in rows[0]


def test_mock_failure_recorded_as_not_ok_and_exception_reraised():
    """回放未命中：记 ok=False，但异常必须原样抛出，调用方行为不变。"""
    with _capture(enabled=True) as c:
        http = MockHttp(mode="replay")  # 无任何录制 → 必然未命中
        try:
            http.fetch("http://example.com/x")
            assert False, "应抛 MockMissError"
        except Exception as e:
            assert "未命中" in str(e)

    rows = [r for r in c.lines() if r["type"] == "tool_io"]
    assert len(rows) == 1
    assert rows[0]["ok"] is False
    assert rows[0]["output"] is None
    assert rows[0]["source"] == "dep"


def test_timed_tool_returns_false_and_reraises():
    """timed_tool 绝不吞异常。"""
    with _capture(enabled=True) as c:
        try:
            with protocol.timed_tool("boom", {}) as ctx:
                ctx.result = "unused"
                raise ValueError("炸了")
        except ValueError:
            pass

    (row,) = c.lines()
    assert row["ok"] is False
    assert row["output"] is None


def test_concurrent_emit_produces_whole_lines():
    """并发发射不得交错出半个 JSON 对象。

    MockHttp/MockDB 可能被 Agent 的工作线程调用，TraceCollector 由主线程调用。
    交错写会让读端按行解析时拿到一行坏数据——而坏数据按约定是要报错中断的。
    """
    with _capture(enabled=True) as c:
        def worker(n):
            for i in range(50):
                protocol.emit({"type": "tool_io", "tool": f"t{n}", "i": i, "pad": "x" * 200})

        threads = [threading.Thread(target=worker, args=(n,)) for n in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

    rows = c.lines()  # 任何一行坏了，json.loads 就会抛错
    assert len(rows) == 200
    assert len({(r["tool"], r["i"]) for r in rows}) == 200, "有重复或丢失"


def test_registry_save_load_unaffected_by_protocol():
    """开不开协议，MockRegistry 的录制/回放行为必须一致。"""
    import tempfile

    d = Path(tempfile.mkdtemp(prefix="ceg-proto-deps-"))
    with _capture(enabled=True):
        reg = MockRegistry(mode="record", sandbox_dir=d / "sb")
        reg.db.execute("CREATE TABLE t (a INTEGER)")
        reg.db.execute("INSERT INTO t VALUES (7)")
        assert reg.db.execute("SELECT a FROM t") == [(7,)]
        reg.save(d)

    with _capture(enabled=False):
        replayed = MockRegistry.load(d, sandbox_dir=d / "sb2")
        assert replayed.db.execute("SELECT a FROM t") == [(7,)]


def test_protocol_importable_without_yaml():
    """protocol 必须零第三方依赖可导入——用户 Agent 的隔离 venv 未必有 yaml。

    历史缺陷：`python/replay/__init__.py` eager import 了 mock/session，于是
    `from python.replay import protocol` 会连带拉起 yaml，让「只想发 span」的
    Agent 因一句无关依赖而崩溃。修复方式是惰性 `__getattr__`（PEP 562）。

    这里在子进程里挂一个 meta-path 拦截器**屏蔽 yaml**，再导入 protocol：
    若仍能成功，即证明解耦成立。
    """
    code = (
        "import sys, importlib.abc\n"
        "class Blocker(importlib.abc.MetaPathFinder):\n"
        "    def find_spec(self, fullname, path=None, target=None):\n"
        "        if fullname == 'yaml' or fullname.startswith('yaml.'):\n"
        "            raise ImportError('yaml blocked for test')\n"
        "        return None\n"
        "sys.meta_path.insert(0, Blocker())\n"
        f"sys.path.insert(0, {str(ROOT)!r})\n"
        "import python.replay.protocol as p\n"
        "import python.otel as otel\n"
        "print('ok', hasattr(p, 'emit'), hasattr(otel, 'TraceCollector'))\n"
    )
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, f"protocol/otel 在无 yaml 环境不可导入：\n{r.stderr}"
    assert r.stdout.strip().endswith("True True")


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    print(f"协议通道测试全部通过 ✅（{len(tests)} 项）")


if __name__ == "__main__":
    main()
