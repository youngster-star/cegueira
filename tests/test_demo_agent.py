"""端到端示例 Agent（fixtures/demo-agent）回归测试。

守住「全流程可离线跑通」这件事：示例 Agent 只依赖本仓的埋点脚手架，不触网、
不调 LLM、不依赖外部服务，因此 `record_agent → manifest` 的结果必须稳定且完整。

验证点：
- 三件套 + manifest 齐全；
- RETRIEVAL span → 1 条 retrieval（含 returnedDocIds / returnedDocs）；
- agent 级工具 → 1 条 tool（name=retrieve）；
- LLM span → 1 条 llmSpan（含 token）；
- final_answer → trace.finalAnswer（含 citedDocIds）。

与 test_record.py 的区别：那边用一个临时 Agent 覆盖多通路边界；这里守的是
**面向用户的示例产物**本身，防止示例随脚手架演进悄悄失效。
"""
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from python.runtime.record import record_agent  # noqa: E402

AGENT_DIR = ROOT / "fixtures" / "demo-agent"


def _record() -> dict:
    run_dir = Path(tempfile.mkdtemp(prefix="ceg-demo-")) / "run"
    res = record_agent(AGENT_DIR, run_dir, python=sys.executable, timeout=60)
    assert res.result is not None, "示例应产出最终结果"
    manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
    return manifest["trace"]


def test_demo_agent_trace_has_signals():
    trace = _record()
    # 非空轨迹：不会触发 grade 的「未埋点 → 分数不可信」告警
    assert len(trace["retrievals"]) == 1, "应有 1 条检索"
    assert len(trace["llmSpans"]) == 1, "应有 1 条 LLM span"
    assert [t["name"] for t in trace["tools"]] == ["retrieve"], "应有 1 次 retrieve 工具调用"


def test_demo_agent_retrieval_carries_docs():
    trace = _record()
    retrieval = trace["retrievals"][0]
    assert retrieval["returnedDocIds"] == ["d1", "d2"]
    # returned_docs（正文）供 answer.text 数据流断言用，必须被归一化保留
    docs = retrieval.get("returnedDocs")
    assert docs is not None and [d["id"] for d in docs] == ["d1", "d2"]
    assert all(isinstance(d["text"], str) and d["text"] for d in docs)


def test_demo_agent_final_answer_cites_retrieved_doc():
    trace = _record()
    assert trace["finalAnswer"]["citedDocIds"] == ["d1"]
    # 引用必须是检索结果的子集（契约断言 cited_doc_ids ⊆ retrieval_doc_ids）
    assert set(trace["finalAnswer"]["citedDocIds"]) <= set(trace["retrievals"][0]["returnedDocIds"])


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    print(f"示例 Agent 端到端回归全部通过 ✅（{len(tests)} 项）")


if __name__ == "__main__":
    main()
