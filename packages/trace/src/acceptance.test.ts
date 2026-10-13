import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  evaluateTaskAcceptance,
  type AcceptanceLike,
} from "./acceptance.js";
import { factsOf, FACT_NAMES, FACT_NAME_SET, FACT_TYPES } from "./facts.js";
import { computeMetrics } from "./metrics.js";
import type { AgentTrace } from "./types.js";

function traceOf(overrides: Partial<AgentTrace>): AgentTrace {
  return { http: [], tools: [], llmSpans: [], retrievals: [], ...overrides };
}

/**
 * 一次「看起来正常」的 RAG 运行：检索两个文档，引用其中一个，调用两个工具。
 * 延迟 900ms（LLM 800 + 两个工具各 50）。
 */
const HEALTHY = traceOf({
  tools: [
    { id: "t1", name: "retrieve", args: { query: "rag" }, result: ["d1", "d2"], ok: true, latencyMs: 50 },
    { id: "t2", name: "generate", args: { prompt: "..." }, result: "answer", ok: true, latencyMs: 50 },
  ],
  llmSpans: [{ id: "s1", promptTokens: 100, completionTokens: 20, latencyMs: 800 }],
  retrievals: [{ id: "r1", query: "rag", returnedDocIds: ["d1", "d2"] }],
  finalAnswer: { text: "RAG 是检索增强生成 [d1]", citedDocIds: ["d1"] },
});

function evalFor(acceptance: AcceptanceLike[], trace: AgentTrace = HEALTHY) {
  const metrics = computeMetrics(trace);
  return evaluateTaskAcceptance(acceptance, trace, factsOf(trace, metrics), metrics);
}

// ---- factsOf ----

test("factsOf：事实全部由轨迹推导，不接受任何自报值", () => {
  const m = computeMetrics(HEALTHY);
  const f = factsOf(HEALTHY, m);

  assert.equal(f.step_count, 2);
  assert.equal(f.retrieval_count, 1);
  assert.equal(f.doc_count, 2, "doc_count 是检索结果中去重的文档 id 数");
  assert.equal(f.latency_ms, 900);
  assert.equal(f.prompt_tokens, 100);
  assert.equal(f.completion_tokens, 20);
  assert.equal(f.has_retrieval, true);
  assert.equal(f.has_final_answer, true);
  assert.equal(f.answer_has_citation, true);
  assert.deepEqual(f.cited_doc_ids, ["d1"]);
  assert.deepEqual(f.retrieval_doc_ids, ["d1", "d2"]);
});

test("factsOf：无检索时 retrieval_hit_rate 记 0 且 has_retrieval=false", () => {
  const trace = traceOf({});
  const m = computeMetrics(trace);
  const f = factsOf(trace, m);
  // 注意与 sSemantic 的差异：那边「无检索」视为不适用给满分，这边是验收要求，记 0
  assert.equal(m.retrievalHitRate, null);
  assert.equal(f.retrieval_hit_rate, 0);
  assert.equal(f.has_retrieval, false);
  assert.equal(f.doc_count, 0);
  assert.deepEqual(f.retrieval_doc_ids, []);
});

test("factsOf：重复返回的文档 id 去重", () => {
  const trace = traceOf({
    retrievals: [
      { id: "r1", query: "a", returnedDocIds: ["d1", "d2"] },
      { id: "r2", query: "b", returnedDocIds: ["d2", "d3"] },
    ],
  });
  const m = computeMetrics(trace);
  assert.equal(factsOf(trace, m).doc_count, 3);
  assert.deepEqual(factsOf(trace, m).retrieval_doc_ids, ["d1", "d2", "d3"]);
});

test("FACT_NAMES 与词汇表键集合一致", () => {
  const m = computeMetrics(traceOf({}));
  const keys = new Set(Object.keys(factsOf(traceOf({}), m)));
  assert.deepEqual([...FACT_NAME_SET].sort(), [...keys].sort());
  assert.equal(FACT_NAME_SET.size, FACT_NAMES.length);
});

test("FACT_TYPES 声明的类型与 factsOf 实际产出的值一一吻合", () => {
  // 这是静态类型表与运行时事实之间唯一的防漂移检查：若某天 doc_count 被改成
  // 返回字符串，契约校验仍会放行（声明是 number），直到评分时才炸。
  for (const trace of [HEALTHY, traceOf({})]) {
    const m = computeMetrics(trace);
    const f = factsOf(trace, m) as Record<string, unknown>;
    for (const name of FACT_NAMES) {
      const declared = FACT_TYPES[name];
      const actual = Array.isArray(f[name])
        ? "string_array"
        : f[name] === null || f[name] === undefined
          ? "null"
          : typeof f[name];
      assert.equal(actual, declared, `${name}: 声明 ${declared}，实际 ${actual}`);
      if (Array.isArray(f[name])) {
        assert.ok(
          (f[name] as unknown[]).every((x) => typeof x === "string"),
          `${name}: string_array 的元素必须都是字符串`,
        );
      }
    }
  }
});

// ---- 四种断言类型 ----

test("assert：表达式通过 / 不通过", () => {
  assert.equal(evalFor([{ type: "assert", expr: "answer_has_citation" }]).rate, 1);
  assert.equal(evalFor([{ type: "assert", expr: "!answer_has_citation" }]).rate, 0);
});

test("assert：引用必须出自检索结果", () => {
  const ok = evalFor([{ type: "assert", expr: "cited_doc_ids ⊆ retrieval_doc_ids" }]);
  assert.equal(ok.passed, 1);

  // 引用了检索结果里没有的文档 → 编造引用
  const hallucinated = traceOf({
    ...HEALTHY,
    finalAnswer: { text: "…[d9]", citedDocIds: ["d9"] },
  });
  const bad = evalFor([{ type: "assert", expr: "cited_doc_ids ⊆ retrieval_doc_ids" }], hallucinated);
  assert.equal(bad.passed, 0);
  assert.equal(bad.rate, 0);
});

test("tool_call_in：全部调用落在白名单内才通过", () => {
  assert.equal(evalFor([{ type: "tool_call_in", tools: ["retrieve", "generate"] }]).rate, 1);
  assert.equal(evalFor([{ type: "tool_call_in", tools: ["retrieve"] }]).rate, 0);
  assert.equal(evalFor([{ type: "tool_call_in", tools: ["other"] }]).rate, 0);
});

test("tool_call_in：无工具调用时真空通过", () => {
  const empty = traceOf({});
  assert.equal(evalFor([{ type: "tool_call_in", tools: ["retrieve"] }], empty).rate, 1);
});

test("no_loop：检测到循环即不通过", () => {
  assert.equal(evalFor([{ type: "no_loop" }]).rate, 1);

  const looping = traceOf({
    tools: [
      { id: "a", name: "search", args: { q: "x" }, result: "r", ok: true, latencyMs: 1 },
      { id: "b", name: "other", args: {}, result: null, ok: true, latencyMs: 1 },
      { id: "c", name: "search", args: { q: "x" }, result: "r", ok: true, latencyMs: 1 },
    ],
  });
  assert.equal(evalFor([{ type: "no_loop" }], looping).rate, 0);
});

test("latency_lt：严格小于（等于不算通过）", () => {
  assert.equal(evalFor([{ type: "latency_lt", maxMs: 1000 }]).rate, 1);
  assert.equal(evalFor([{ type: "latency_lt", maxMs: 900 }]).rate, 0, "900ms 不满足 < 900ms");
  assert.equal(evalFor([{ type: "latency_lt", maxMs: 899 }]).rate, 0);
});

// ---- 「不可求值」与「未通过」必须分开 ----

test("不可求值的断言不计入分母，也不静默放行", () => {
  const r = evalFor([
    { type: "assert", expr: "answer_has_citation" }, // 通过
    { type: "assert", expr: "index_size == doc_count" }, // 未识别标识符
  ]);
  assert.equal(r.total, 2);
  assert.equal(r.evaluable, 1);
  assert.equal(r.passed, 1);
  assert.equal(r.rate, 1, "分母只算可求值的 1 条");
  assert.equal(r.outcomes[1].passed, false);
  assert.match(r.outcomes[1].unevaluable ?? "", /未识别的标识符 index_size/);
});

test("自然语言断言被标记为不可求值，而不是判定为不通过", () => {
  const r = evalFor([
    { type: "assert", expr: "cited_doc_ids ⊆ retrieval_doc_ids" },
    { type: "assert", expr: "cited_doc_ids 全部来自检索结果" },
  ]);
  assert.equal(r.evaluable, 1);
  assert.equal(r.rate, 1);
  assert.notEqual(r.outcomes[1].unevaluable, undefined);
});

test("类型不符的断言同样归为契约缺陷", () => {
  const mixed = evalFor([
    { type: "assert", expr: "doc_count ⊆ cited_doc_ids" },
    { type: "no_loop" },
  ]);
  assert.equal(mixed.evaluable, 1);
  assert.match(mixed.outcomes[0].unevaluable ?? "", /必须是字符串数组/);
  assert.equal(mixed.rate, 1);
});

test("一条都不可求值时抛错，而不是返回 0 分", () => {
  assert.throws(
    () => evalFor([{ type: "assert", expr: "index_size == doc_count" }]),
    /没有一条可求值的验收断言.*未识别的标识符 index_size/,
  );
  assert.throws(() => evalFor([{ type: "assert" }]), /没有一条可求值的验收断言/);
  assert.throws(() => evalFor([]), /没有一条可求值的验收断言.*该任务没有任何验收断言/);
});

test("断言缺字段时归为不可求值而非不通过", () => {
  const r = evalFor([
    { type: "assert" },
    { type: "tool_call_in" },
    { type: "latency_lt" },
    { type: "no_loop" },
  ]);
  assert.equal(r.total, 4);
  assert.equal(r.evaluable, 1, "只有 no_loop 可求值");
  assert.equal(r.rate, 1);
  assert.match(r.outcomes[0].unevaluable ?? "", /缺少布尔表达式/);
  assert.match(r.outcomes[1].unevaluable ?? "", /缺少工具白名单/);
  assert.match(r.outcomes[2].unevaluable ?? "", /缺少正数 maxMs/);
});

test("未知断言类型（脏 JSON）被归为不可求值", () => {
  const dirty = [{ type: "assert_all_of" } as unknown as AcceptanceLike, { type: "no_loop" as const }];
  const r = evalFor(dirty);
  assert.equal(r.evaluable, 1);
  assert.match(r.outcomes[0].unevaluable ?? "", /未知 acceptance 类型/);
});

// ---- 报告字段 ----

test("outcomes 带下标、原文与描述，便于回指契约", () => {
  const r = evalFor([
    { type: "assert", expr: "doc_count >= 2", description: "至少检索到 2 个文档块" },
  ]);
  assert.equal(r.outcomes[0].index, 0);
  assert.equal(r.outcomes[0].type, "assert");
  assert.equal(r.outcomes[0].spec, "doc_count >= 2");
  assert.equal(r.outcomes[0].description, "至少检索到 2 个文档块");
  assert.equal(r.outcomes[0].passed, true);
});

test("通过率是 passed / evaluable 的比例", () => {
  const r = evalFor([
    { type: "assert", expr: "doc_count >= 2" }, // 通过
    { type: "assert", expr: "doc_count >= 99" }, // 不通过
    { type: "no_loop" }, // 通过
    { type: "assert", expr: "index_size >= 1" }, // 不可求值
  ]);
  assert.equal(r.total, 4);
  assert.equal(r.evaluable, 3);
  assert.equal(r.passed, 2);
  assert.ok(Math.abs(r.rate - 2 / 3) < 1e-12);
});

// ---- 确定性（回放两次结果必须一致） ----

test("同一轨迹两次求值完全一致", () => {
  const acceptance: AcceptanceLike[] = [
    { type: "assert", expr: "cited_doc_ids ⊆ retrieval_doc_ids" },
    { type: "tool_call_in", tools: ["retrieve", "generate"] },
    { type: "no_loop" },
    { type: "latency_lt", maxMs: 1000 },
  ];
  const a = evalFor(acceptance);
  const b = evalFor(acceptance);
  assert.deepEqual(a, b);
});
