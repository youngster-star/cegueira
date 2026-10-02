import { strict as assert } from "node:assert";
import { test } from "node:test";
import { detectCheat } from "./index.js";
import { rewritePrompt, overlapRatio, detectHardcoded } from "./rewrite.js";
import { checkDataFlow } from "./dataflow.js";
import type { AgentTrace } from "@cegueira/trace";
import type { EvalCase } from "./types.js";

function traceOf(overrides: Partial<AgentTrace>): AgentTrace {
  return {
    http: [],
    tools: [],
    llmSpans: [],
    retrievals: [],
    ...overrides,
  };
}

const baseCase: EvalCase = {
  id: "t1",
  prompt: "什么是 RAG？",
  expectedOutcome: "contains_retrieved_fact",
  dataFlowAssertions: [],
  split: "public",
  rewrites: [],
};

test("全部合规时 cheated=false", () => {
  const r = detectCheat({
    trace: traceOf({ finalAnswer: { text: "RAG 是检索增强生成。", citedDocIds: [] } }),
    runCaseIds: ["t1"],
    evalCases: [baseCase],
  });
  assert.equal(r.cheated, false);
  assert.equal(r.reasons.length, 0);
});

test("防线 1：跳过留出集判作弊", () => {
  const holdout: EvalCase = { ...baseCase, id: "holdout-1", split: "holdout" };
  const r = detectCheat({
    trace: traceOf({}),
    runCaseIds: ["t1"], // 未运行 holdout-1
    evalCases: [baseCase, holdout],
  });
  assert.equal(r.holdoutIntact, false);
  assert.deepEqual(r.holdoutMissing, ["holdout-1"]);
  assert.equal(r.cheated, true);
});

test("防线 2：答案复制题目被判硬编码", () => {
  const prompt = "什么是 RAG？请用自己的话解释检索增强生成。";
  const answer = prompt; // 完全复制
  const r = detectCheat({
    trace: traceOf({ finalAnswer: { text: answer, citedDocIds: [] } }),
    runCaseIds: ["t1"],
    evalCases: [{ ...baseCase, prompt }],
  });
  assert.equal(r.rewriteSuspicious, true);
  assert.equal(r.cheated, true);
});

test("防线 3：引用不存在的文档判伪造引用", () => {
  const r = detectCheat({
    trace: traceOf({
      retrievals: [{ id: "r1", query: "q", returnedDocIds: ["doc1"] }],
      finalAnswer: { text: "答案", citedDocIds: ["doc1", "ghost-doc"] },
    }),
    runCaseIds: ["t1"],
    evalCases: [
      {
        ...baseCase,
        dataFlowAssertions: [
          { source: "retrieval", field: "answer.cited_doc_ids" },
        ],
      },
    ],
  });
  assert.equal(r.dataFlowViolations.length, 1);
  assert.equal(r.cheated, true);
});

test("防线 4：引用噪声文档判被污染", () => {
  const r = detectCheat({
    trace: traceOf({
      retrievals: [{ id: "r1", query: "q", returnedDocIds: ["noise-1", "doc1"] }],
      finalAnswer: { text: "答案", citedDocIds: ["noise-1"] },
    }),
    runCaseIds: ["t1"],
    evalCases: [{ ...baseCase, noiseDocIds: ["noise-1"] }],
  });
  assert.equal(r.perturbationResistant, false);
  assert.deepEqual(r.perturbationLeaks, ["noise-1"]);
  assert.equal(r.cheated, true);
});

test("改写提示：同义改写改变字面、保留语义要求", () => {
  const a = rewritePrompt("什么是 RAG", 0);
  const b = rewritePrompt("什么是 RAG", 1);
  assert.notEqual(a, b);
  assert.ok(a.includes("RAG") || b.includes("RAG"));
});

test("overlapRatio：相同文本为 1，无关文本为 0", () => {
  assert.equal(overlapRatio("什么是 RAG", "什么是 RAG"), 1);
  assert.equal(overlapRatio("什么是 RAG", "今天天气不错"), 0);
});

test("detectHardcoded：高重叠为真，正常作答为假", () => {
  assert.equal(detectHardcoded("什么是 RAG 检索增强生成", "什么是 RAG 检索增强生成"), true);
  assert.equal(detectHardcoded("什么是 RAG", "检索增强生成是一种结合检索与生成的技术"), false);
});

test("checkDataFlow：tool 来源校验工具返回的 id", () => {
  const violations = checkDataFlow(
    traceOf({
      tools: [
        { id: "t1", name: "search", args: {}, result: [{ id: "doc1" }], ok: true, latencyMs: 1 },
      ],
      finalAnswer: { text: "答案", citedDocIds: ["doc1", "fake"] },
    }),
    [{ source: "tool", field: "answer.cited_doc_ids" }],
  );
  assert.deepEqual(violations, ['引用未由工具返回的 id "fake"']);
});
