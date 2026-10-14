"""离线示例 Agent：零外部依赖，发出一整条完整协议轨迹。

用途（对应 docs/stages/P1-MVP.md「端到端完成 1 个 RAG Agent」）：

- 让 `ceg init → ceg record → ceg grade` 全流程有一个**可离线跑通、结果有意义**
  的样例（现有 hello-agent / echo-agent 都不发协议行，tool-agent 依赖外部服务）；
- 同时演示用户自己的 Agent 应如何用 `python.otel` / `python.replay.protocol` 埋点。

它不调用任何 LLM 或外部 API：检索与生成都基于内置的确定性数据，因此两次录制
的轨迹完全一致（确定性），适合做演示与回归。

发出的协议行（仅在 CEG_PROTOCOL=1 时，该变量由 `ceg record` 注入）：

    RETRIEVAL span（query / returned_doc_ids / returned_docs）
    tool_io（agent 级工具 retrieve）
    LLM span（prompt_tokens / completion_tokens）
    trace（Agent 最终输出，含 final_answer）
"""
import json
import os
import sys
from pathlib import Path

# 让 `import python.otel` 可见：录制时 CLI 已注入 PYTHONPATH（仓库根），
# 直接 `python main.py` 运行时这里兜底。仓库根 = 本文件向上两级。
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from python.otel import TraceCollector  # noqa: E402
from python.replay.protocol import timed_tool  # noqa: E402

# 内置确定性语料（键 = 文档 id）
DOCS = {
    "d1": "检索增强生成（RAG）结合检索与生成，能显著减少大模型幻觉。",
    "d2": "向量数据库用于高维近邻检索，是 RAG 的常见组件。",
}


def main() -> None:
    # 逐 case 录制时由 CLI 注入题目；否则取命令行参数或默认值。
    question = os.environ.get("CEG_CASE_PROMPT") or (
        sys.argv[1] if len(sys.argv) > 1 else "什么是 RAG？"
    )

    collector = TraceCollector()

    # 1) 检索：发出 RETRIEVAL span——S_outcome 的检索类事实（doc_count /
    #    retrieval_hit_rate）只认它。returned_docs 供 answer.text 数据流断言用。
    retrieve = collector.start_span(
        "retrieve",
        kind="RETRIEVAL",
        query=question,
        returned_doc_ids=list(DOCS),
        returned_docs=[{"id": k, "text": v} for k, v in DOCS.items()],
    )
    # 2) 工具调用：agent 级工具（S_process 的步数单位；工具名须在契约白名单内）。
    with timed_tool("retrieve", {"query": question}) as call:
        call.result = list(DOCS)
    retrieve.end()

    # 3) 生成：LLM span（token / 延迟指标的来源）。
    generate = collector.start_span(
        "generate", kind="LLM", prompt_tokens=64, completion_tokens=24
    )
    generate.end()

    # 4) 最终答案：引用来自检索结果（断言 cited_doc_ids ⊆ returned_doc_ids）。
    answer = "RAG 是检索增强生成 [d1]：它用检索到的资料支撑生成，从而减少幻觉。"
    sys.stdout.write(
        json.dumps(
            {"type": "trace", "final_answer": {"text": answer, "cited_doc_ids": ["d1"]}},
            ensure_ascii=False,
        )
        + "\n"
    )
    sys.stdout.flush()


if __name__ == "__main__":
    main()
