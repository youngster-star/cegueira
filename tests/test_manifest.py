"""跨语言往返断言：Python 组装的 manifest 必须与 TS 的 parseRecording 逐字一致。

## 这条测试在防什么

同一份归一化逻辑存在两处实现：

- `python/replay/manifest.py`（录制时组装 manifest.json，桌面端读它）
- `packages/trace/src/load.ts` 的 `parseRecording`（CLI 与测试用的纯函数）

两份实现一旦漂移，就会出现**两种真相**：桌面端显示一套数字，CLI 显示另一套，
而两边都不会报错。这类缺陷极难定位，因为它不表现为崩溃，只表现为「分数对不上」。

因此这里让 Node 调 `parseRecording` 解析同一份三件套，结果必须与 Python 写出的
`manifest.trace` **深度相等**。漂移从此是测试失败，不是静默分歧。

## 与既有测试的关系

本文件不替代 `test_session.py`（那边测三件套自身的落盘/读回），
只测**归一化**这一步——即「三件套 → AgentTrace」的两种实现是否同构。

## 跳过条件

需要 Node 在 PATH 上。CI 与本机开发环境都有；纯 Python 环境下跳过并明确提示，
不静默通过。
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from python.replay.manifest import (  # noqa: E402
    ManifestError,
    build_manifest,
    build_trace,
    final_answer_of,
    read_manifest,
    write_manifest,
)
from python.replay.session import RecordingSession  # noqa: E402

NODE = shutil.which("node")


def _tmpdir() -> Path:
    return Path(tempfile.mkdtemp(prefix="ceg-manifest-"))


def _node_parse_recording(run_dir: Path) -> dict:
    """调 Node 跑 parseRecording，把 AgentTrace 以 JSON 打回。

    用子进程而非重写一遍逻辑：这样测的才是**真正会被 CLI 调用的那份代码**。

    `result.json` 由调用方保证一定存在（无结果时写空串），因此这里无条件读取：
    `parseResultLine("")` 返回 undefined，与「本就没有 final_answer」等价。
    """
    script = (
        "import { readFileSync } from 'node:fs';"
        "import { parseRecording } from '@cegueira/trace/load';"
        "const d = process.argv[1];"
        "const read = (n) => readFileSync(d + '/' + n, 'utf8');"
        "process.stdout.write(JSON.stringify(parseRecording({"
        "  http: read('http.yaml'), trace: read('trace.json'),"
        "  toolIo: read('tool_io.log'), result: read('result.json') })));"
    )
    proc = subprocess.run(
        [NODE, "--input-type=module", "-e", script, str(run_dir)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if proc.returncode != 0:
        raise AssertionError(f"Node 侧 parseRecording 失败：\n{proc.stderr}")
    return json.loads(proc.stdout)


def _build_run(session: RecordingSession, result: dict | None = None):
    """把一份 session 落盘为三件套 + result.json + manifest，返回 (目录, manifest)。"""
    d = _tmpdir()
    session.save(d)
    # 无结果时也写一个空文件，让 Node 侧可以无条件读取
    (d / "result.json").write_text(
        "" if result is None else json.dumps(result, ensure_ascii=False), encoding="utf-8"
    )
    manifest = build_manifest(session.run_id, session.http_records, session.spans, session.tool_io, result)
    write_manifest(d / "manifest.json", manifest)
    return d, manifest


def _roundtrip(session: RecordingSession, result: dict | None = None) -> dict:
    """跑一次往返断言，返回 manifest["trace"]。"""
    d, manifest = _build_run(session, result)
    from_ts = _node_parse_recording(d)
    assert from_ts == manifest["trace"], (
        "两处归一化实现已漂移——Python 组装的 manifest 与 TS 的 parseRecording 不一致。\n"
        f"Python: {json.dumps(manifest['trace'], ensure_ascii=False, sort_keys=True)}\n"
        f"TS    : {json.dumps(from_ts, ensure_ascii=False, sort_keys=True)}"
    )
    return manifest["trace"]


def _full_session() -> RecordingSession:
    """一份覆盖全部四类归一化分支的录制。"""
    s = RecordingSession(run_id="run-roundtrip")
    s.add_http("POST", "api.openai.com", "/v1/chat/completions", b'{"model":"gpt"}', 200, b'{"ok":true}')
    s.add_http("GET", "example.com", "/search?q=rag", b"", 200, b'{"hits":[]}')
    s.add_span("retrieve", "RETRIEVAL", 0.0, 12.5, query="rag", returned_doc_ids=["d1", "d2"])
    s.add_span("chat", "LLM", 20.0, 800.0, prompt_tokens=100, completion_tokens=20)
    s.add_span("outer", "CHAIN", 0.0, 900.0)
    s.add_span("search", "TOOL", 30.0, 5.0, tool_name="retrieve")
    s.add_tool_io("retrieve", {"query": "rag"}, ["d1", "d2"], True, 12.5)
    s.add_tool_io("generate", {"prompt": "p"}, "answer", True, 30.0)
    # 外部依赖调用（source=dep）：必须被两侧一致地过滤掉，否则「步数」会按
    # 外部调用数膨胀，而契约里的 tool_call_in 白名单又永远匹配不到 db.execute
    s.add_tool_io("db.execute", {"sql": "SELECT 1", "params": []}, {"row_count": 1}, True, 1.0, source="dep")
    s.add_tool_io("http.fetch", {"url": "http://x/y"}, "{}", False, 2.0, source="dep")
    # 旧版产物没有 source 字段 → 按 Agent 工具处理
    s.tool_io.append({"tool": "legacy_tool", "input": {}, "output": None, "ok": True, "latency_ms": 3.0})
    return s


def test_roundtrip_full_recording():
    """端到端：三件套 + result → 两侧归一化结果必须完全一致。"""
    if NODE is None:
        print("  ⚠ 跳过：PATH 上找不到 node，无法验证跨语言一致性")
        return
    result = {"type": "trace", "final_answer": {"text": "RAG 是检索增强生成 [d1]", "cited_doc_ids": ["d1"]}}
    trace = _roundtrip(_full_session(), result)
    assert trace["finalAnswer"] == {"text": "RAG 是检索增强生成 [d1]", "citedDocIds": ["d1"]}
    assert len(trace["http"]) == 2
    # 3 条 agent 工具（含无 source 字段的旧版记录），2 条 dep 被过滤
    assert len(trace["tools"]) == 3
    assert [t["name"] for t in trace["tools"]] == ["retrieve", "generate", "legacy_tool"]
    assert [t["id"] for t in trace["tools"]] == ["tool-1", "tool-2", "tool-3"]
    assert len(trace["llmSpans"]) == 1
    assert len(trace["retrievals"]) == 1


def test_roundtrip_without_final_answer():
    """没有 final_answer 时两侧都不得出现 finalAnswer 键（而不是各编一个空答案）。"""
    if NODE is None:
        print("  ⚠ 跳过：PATH 上找不到 node")
        return
    trace = _roundtrip(_full_session(), None)
    assert "finalAnswer" not in trace


def test_roundtrip_empty_recording():
    """空录制：两侧都得空数组，不是 None 也不是报错。"""
    if NODE is None:
        print("  ⚠ 跳过：PATH 上找不到 node")
        return
    trace = _roundtrip(RecordingSession(run_id="empty"))
    assert trace == {"http": [], "tools": [], "llmSpans": [], "retrievals": []}


def test_roundtrip_without_host():
    """旧版扁平录制的记录没有 host —— 两侧都必须如实留空而非编占位值。"""
    if NODE is None:
        print("  ⚠ 跳过：PATH 上找不到 node")
        return
    s = RecordingSession(run_id="no-host")
    s.http_records["deadbeef"] = {
        "request": {"method": "POST", "path": "/v1/chat", "body": "{}"},
        "response": {"status": 200, "body": "{}"},
    }
    trace = _roundtrip(s)
    assert trace["http"][0]["request"] == {"method": "POST", "path": "/v1/chat", "body": "{}"}


def test_http_sorted_by_fingerprint():
    """http 必须按指纹排序——依赖字典插入顺序在两种语言里结果不同。"""
    s = RecordingSession(run_id="order")
    # 指纹是 body 的哈希，插入顺序与指纹顺序无关，正好用来验证排序
    for n in (3, 1, 2):
        s.add_http("POST", "h", "/p", json.dumps({"n": n}).encode("utf-8"), 200, b"x")
    trace = build_trace(s.http_records, s.spans, s.tool_io)
    fps = [e["fingerprint"] for e in trace["http"]]
    assert fps == sorted(fps)
    assert len(fps) == 3


def test_unknown_span_kind_raises():
    """未知 kind 必须报错——静默跳过会把「埋点写错」伪装成「这个 Agent 没检索」。"""
    s = RecordingSession(run_id="typo")
    s.add_span("retrieve", "RETRIVAL", 0.0, 1.0, query="q", returned_doc_ids=[])
    try:
        build_trace(s.http_records, s.spans, s.tool_io)
        assert False, "应抛 ManifestError"
    except ManifestError as e:
        assert "RETRIVAL" in str(e)


def test_retrieval_span_missing_attrs_raises():
    """RETRIEVAL span 缺 query / returned_doc_ids 都报错——它们是断言的唯一依据。"""
    for attrs, missing in (({"returned_doc_ids": []}, "query"), ({"query": "q"}, "returned_doc_ids")):
        s = RecordingSession(run_id="missing")
        s.add_span("retrieve", "RETRIEVAL", 0.0, 1.0, **attrs)
        try:
            build_trace(s.http_records, s.spans, s.tool_io)
            assert False, f"应抛 ManifestError（缺 {missing}）"
        except ManifestError as e:
            assert missing in str(e)


def test_roundtrip_returned_docs():
    """RETRIEVAL 携带 returned_docs（文档正文）时，两侧必须一致地归一化出 returnedDocs。"""
    if NODE is None:
        print("  ⚠ 跳过：PATH 上找不到 node")
        return
    s = RecordingSession(run_id="docs")
    s.add_span(
        "retrieve", "RETRIEVAL", 0.0, 1.0,
        query="rag", returned_doc_ids=["d1"],
        returned_docs=[{"id": "d1", "text": "检索增强生成"}],
    )
    trace = _roundtrip(s)
    assert trace["retrievals"][0]["returnedDocs"] == [{"id": "d1", "text": "检索增强生成"}]


def test_retrieval_returned_docs_malformed_raises():
    """returned_docs 元素缺 text 必须报错——否则 answer.text 断言会静默失据。"""
    s = RecordingSession(run_id="bad-docs")
    s.add_span(
        "retrieve", "RETRIEVAL", 0.0, 1.0,
        query="q", returned_doc_ids=["d1"], returned_docs=[{"id": "d1"}],
    )
    try:
        build_trace(s.http_records, s.spans, s.tool_io)
        assert False, "应抛 ManifestError（缺 text）"
    except ManifestError as e:
        assert "text" in str(e)


def test_final_answer_of_variants():
    """final_answer 的三种形态：完整 / 缺引用列表 / 整个缺失。"""
    assert final_answer_of(None) is None
    assert final_answer_of({"type": "trace"}) is None
    assert final_answer_of({"final_answer": {"text": "x"}}) == {"text": "x", "citedDocIds": []}
    assert final_answer_of({"final_answer": {"text": "x", "cited_doc_ids": ["d1"]}}) == {
        "text": "x",
        "citedDocIds": ["d1"],
    }


def test_manifest_roundtrip_and_missing_trace():
    """manifest 自身的落盘/读回，以及缺 trace 字段时报错。"""
    d = _tmpdir()
    manifest = build_manifest("r", {}, [], [], None)
    write_manifest(d / "manifest.json", manifest)
    assert read_manifest(d / "manifest.json")["run_id"] == "r"

    bad = d / "bad.json"
    bad.write_text('{"schema": "1.0"}', encoding="utf-8")
    try:
        read_manifest(bad)
        assert False, "应抛 ManifestError"
    except ManifestError:
        pass


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    suffix = "" if NODE else "（Node 不可用，跨语言往返已跳过）"
    print(f"manifest 跨语言往返断言全部通过 ✅（{len(tests)} 项）{suffix}")


if __name__ == "__main__":
    main()
