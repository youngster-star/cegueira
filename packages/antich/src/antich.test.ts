import { strict as assert } from "node:assert";
import { test } from "node:test";
import { detectCheat, mergeAntiCheat } from "./index.js";
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

test("traceCaseId：只与自身 case 比对，避免跨 case 误判硬编码", () => {
  const answer = "苹果香蕉橙子葡萄西瓜柠檬柚子";
  const caseA: EvalCase = { ...baseCase, id: "A", prompt: "完全不同的题目内容在这里" };
  const caseB: EvalCase = { ...baseCase, id: "B", prompt: answer }; // 与答案字面相同
  const trace = traceOf({ finalAnswer: { text: answer, citedDocIds: [] } });

  // 不隔离：答案与 B 的题目重叠 → 误判硬编码
  const all = detectCheat({ trace, runCaseIds: ["A", "B"], evalCases: [caseA, caseB] });
  assert.equal(all.rewriteSuspicious, true);

  // 隔离到 A：只比 A 的题目（与答案不重叠）→ 不误判
  const isolated = detectCheat({
    trace,
    runCaseIds: ["A", "B"],
    evalCases: [caseA, caseB],
    traceCaseId: "A",
  });
  assert.equal(isolated.rewriteSuspicious, false);
});

test("traceCaseId：留出集完整性仍用全量 evalCases（运行级）", () => {
  const holdout: EvalCase = { ...baseCase, id: "h1", split: "holdout" };
  const r = detectCheat({
    trace: traceOf({}),
    runCaseIds: ["A"], // h1 未运行
    evalCases: [{ ...baseCase, id: "A" }, holdout],
    traceCaseId: "A",
  });
  assert.equal(r.holdoutIntact, false);
  assert.deepEqual(r.holdoutMissing, ["h1"]);
});

test("mergeAntiCheat：任一 case 作弊即整体作弊，字段去重合并", () => {
  const clean = detectCheat({
    trace: traceOf({ finalAnswer: { text: "正常答案", citedDocIds: [] } }),
    runCaseIds: ["A"],
    evalCases: [{ ...baseCase, id: "A" }],
  });
  const dirty = detectCheat({
    trace: traceOf({
      finalAnswer: { text: "x", citedDocIds: ["ghost"] },
    }),
    runCaseIds: ["A"],
    evalCases: [
      {
        ...baseCase,
        id: "A",
        dataFlowAssertions: [{ source: "retrieval", field: "answer.cited_doc_ids" }],
      },
    ],
  });
  const merged = mergeAntiCheat([clean, dirty]);
  assert.equal(merged.cheated, true);
  assert.equal(merged.holdoutIntact, true);
  assert.equal(merged.dataFlowViolations.length, 1);
  assert.equal(mergeAntiCheat([]).cheated, false);
});
