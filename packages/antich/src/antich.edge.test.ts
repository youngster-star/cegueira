import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCheat } from "./index.js";
import { rewritePrompt } from "./rewrite.js";
import { checkDataFlow, extractIds, extractStrings, textGroundedness } from "./dataflow.js";
import { checkHoldout } from "./holdout.js";
import { checkPerturbation } from "./perturb.js";
import type { AgentTrace } from "@cegueira/trace";
import type { EvalCase } from "./types.js";

function traceOf(overrides: Partial<AgentTrace>): AgentTrace {
  return { http: [], tools: [], llmSpans: [], retrievals: [], ...overrides };
}

const baseCase: EvalCase = {
  id: "t1",
  prompt: "什么是 RAG？",
  expectedOutcome: "contains_retrieved_fact",
  dataFlowAssertions: [],
  split: "public",
  rewrites: [],
};

// ---------- 防线 2：改写 ----------

test("rewritePrompt：variant 越界取模轮转", () => {
  const a = rewritePrompt("什么是 RAG", 0);
  const b = rewritePrompt("什么是 RAG", 2); // 2 % 2 == 0，同 variant 0
  assert.equal(a, b);
  const c = rewritePrompt("什么是 RAG", 1);
  assert.notEqual(a, c);
});

test("rewritePrompt：无同义词命中时附加标记、保留原题", () => {
  const out = rewritePrompt("量子力学是什么", 0);
  assert.ok(out.includes("量子力学是什么"));
  assert.ok(out.includes("请用自己的话作答"));
});

test("rewritePrompt：同义词替换只改首个命中（不链式替换）", () => {
  // 「什么是」→「请解释」，其后不应再对「解释」二次替换
  const out = rewritePrompt("什么是", 0);
  assert.equal(out, "请解释");
});

// ---------- 防线 3：数据流 ----------

test("extractIds：深层嵌套对象/数组递归提取", () => {
  const ids = extractIds({ data: [{ id: "a" }, { nested: { id: "b" } }], id: "c" });
  assert.deepEqual(ids.sort(), ["a", "b", "c"]);
});

test("extractIds：空/标量返回空数组", () => {
  assert.deepEqual(extractIds(null), []);
  assert.deepEqual(extractIds(undefined), []);
  assert.deepEqual(extractIds("str"), []);
  assert.deepEqual(extractIds(42), []);
});

test("checkDataFlow：缺少最终答案时判违规", () => {
  const violations = checkDataFlow(
    traceOf({ finalAnswer: undefined }),
    [{ source: "retrieval", field: "answer.cited_doc_ids" }],
  );
  assert.equal(violations.length, 1);
  assert.ok(violations[0].includes("缺少最终答案"));
});

test("checkDataFlow：未知 field 跳过（不误报）", () => {
  const violations = checkDataFlow(
    traceOf({ finalAnswer: { text: "x", citedDocIds: [] } }),
    [{ source: "retrieval", field: "answer.unknown" }],
  );
  assert.deepEqual(violations, []);
});

test("checkDataFlow：answer.text 无来源正文时跳过（不误报）", () => {
  const violations = checkDataFlow(
    traceOf({ finalAnswer: { text: "一段足够长的答案文本内容", citedDocIds: [] } }),
    [{ source: "retrieval", field: "answer.text" }],
  );
  assert.deepEqual(violations, []);
});

test("checkDataFlow：answer.text 有检索正文支撑 → 通过", () => {
  const violations = checkDataFlow(
    traceOf({
      retrievals: [
        {
          id: "r1",
          query: "q",
          returnedDocIds: ["d1"],
          returnedDocs: [{ id: "d1", text: "检索增强生成是一种结合检索与生成的技术" }],
        },
      ],
      finalAnswer: { text: "检索增强生成结合了检索与生成", citedDocIds: ["d1"] },
    }),
    [{ source: "retrieval", field: "answer.text" }],
  );
  assert.deepEqual(violations, []);
});

test("checkDataFlow：answer.text 与检索正文零重叠 → 判疑似幻觉", () => {
  const violations = checkDataFlow(
    traceOf({
      retrievals: [
        {
          id: "r1",
          query: "q",
          returnedDocIds: ["d1"],
          returnedDocs: [{ id: "d1", text: "检索增强生成是一种结合检索与生成的技术" }],
        },
      ],
      finalAnswer: { text: "苹果香蕉橙子葡萄西瓜柠檬柚子桃子", citedDocIds: [] },
    }),
    [{ source: "retrieval", field: "answer.text" }],
  );
  assert.equal(violations.length, 1);
  assert.ok(violations[0].includes("疑似幻觉"));
});

test("checkDataFlow：answer.text 来源为工具返回的字符串", () => {
  const violations = checkDataFlow(
    traceOf({
      tools: [
        { id: "t1", name: "search", args: {}, result: { text: "检索增强生成是一种技术" }, ok: true, latencyMs: 1 },
      ],
      finalAnswer: { text: "苹果香蕉橙子葡萄西瓜柠檬柚子桃子", citedDocIds: [] },
    }),
    [{ source: "tool", field: "answer.text" }],
  );
  assert.equal(violations.length, 1);
});

test("extractStrings：递归收集对象/数组中的字符串", () => {
  assert.deepEqual(
    extractStrings({ a: "x", b: ["y", { c: "z" }], n: 3 }),
    ["x", "y", "z"],
  );
});

test("textGroundedness：无正文或答案过短 → null；完全一致 → 1", () => {
  assert.equal(textGroundedness("abcd", []), null);
  assert.equal(textGroundedness("ab", ["abcdefgh"]), null); // 答案 < 4 字符
  assert.equal(textGroundedness("abcdefgh", ["abcdefgh"]), 1);
  assert.equal(textGroundedness("abcdefgh", ["zzzzzzzz"]), 0);
});

test("checkDataFlow：tool 来源校验工具返回的 id", () => {
  const violations = checkDataFlow(
    traceOf({
      tools: [{ id: "t1", name: "search", args: {}, result: { items: [{ id: "doc1" }] }, ok: true, latencyMs: 1 }],
      finalAnswer: { text: "x", citedDocIds: ["doc1"] },
    }),
    [{ source: "tool", field: "answer.cited_doc_ids" }],
  );
  assert.deepEqual(violations, [], "doc1 来自工具返回，应通过");
});

// ---------- 防线 1：留出集 ----------

test("checkHoldout：无 holdout 时 intact=true", () => {
  const r = checkHoldout(["t1"], []);
  assert.equal(r.intact, true);
  assert.deepEqual(r.missing, []);
});

test("checkHoldout：部分缺失返回精确清单", () => {
  const r = checkHoldout(["t1"], ["h1", "h2"]);
  assert.equal(r.intact, false);
  assert.deepEqual(r.missing, ["h1", "h2"]);
});

// ---------- 防线 4：语料扰动 ----------

test("checkPerturbation：无最终答案或无噪声时 resistant=true", () => {
  assert.equal(checkPerturbation(undefined, ["n1"]).resistant, true);
  assert.equal(checkPerturbation({ text: "x", citedDocIds: ["n1"] }, []).resistant, true);
});

test("checkPerturbation：引用多个噪声文档全部列出", () => {
  const r = checkPerturbation(
    { text: "x", citedDocIds: ["n1", "doc1", "n2"] },
    ["n1", "n2"],
  );
  assert.equal(r.resistant, false);
  assert.deepEqual(r.leaks, ["n1", "n2"]);
});

// ---------- 综合判定 ----------

test("detectCheat：多重违规同时触发，reasons 汇总全部", () => {
  const r = detectCheat({
    trace: traceOf({
      retrievals: [{ id: "r1", query: "q", returnedDocIds: ["doc1"] }],
      finalAnswer: { text: "什么是 RAG？", citedDocIds: ["doc1", "noise-1"] },
    }),
    runCaseIds: ["t1"], // 跳过 holdout-1
    evalCases: [
      { ...baseCase, prompt: "什么是 RAG？", dataFlowAssertions: [{ source: "retrieval", field: "answer.cited_doc_ids" }], noiseDocIds: ["noise-1"] },
      { ...baseCase, id: "holdout-1", split: "holdout" },
    ],
  });
  assert.equal(r.cheated, true);
  assert.equal(r.holdoutIntact, false);
  assert.ok(r.reasons.some((x) => x.includes("留出集")));
  assert.ok(r.reasons.some((x) => x.includes("硬编码")), "答案复制题目应触发硬编码");
  assert.ok(r.reasons.some((x) => x.includes("数据流")));
  assert.ok(r.reasons.some((x) => x.includes("噪声")));
});

test("detectCheat：空 evalCases 时 cheated=false", () => {
  const r = detectCheat({ trace: traceOf({}), runCaseIds: [], evalCases: [] });
  assert.equal(r.cheated, false);
  assert.deepEqual(r.reasons, []);
});
