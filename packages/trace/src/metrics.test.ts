import { strict as assert } from "node:assert";
import { test } from "node:test";
import { computeMetrics, normalizeArgs } from "./metrics.js";
import type { AgentTrace } from "./types.js";

function traceOf(overrides: Partial<AgentTrace>): AgentTrace {
  return {
    http: [],
    tools: [],
    llmSpans: [],
    retrievals: [],
    ...overrides,
  };
}

test("空轨迹返回中性指标", () => {
  const m = computeMetrics(traceOf({}));
  assert.equal(m.steps, 0);
  assert.equal(m.toolChoiceAccuracy, 1);
  assert.equal(m.paramCorrectness, 1);
  assert.equal(m.successRate, 1);
  assert.equal(m.stepRedundancy, 0);
  assert.equal(m.loopCount, 0);
  assert.equal(m.retrievalHitRate, null);
  assert.equal(m.totalLatencyMs, 0);
});

test("工具选择准确率：调用了未声明工具会被扣分", () => {
  const trace = traceOf({
    tools: [
      { id: "1", name: "search", args: {}, result: [], ok: true, latencyMs: 1 },
      { id: "2", name: "drop_table", args: {}, result: null, ok: true, latencyMs: 1 },
    ],
  });
  const m = computeMetrics(trace, ["search", "fetch"]);
  assert.equal(m.toolChoiceAccuracy, 0.5);
});

test("参数正确率：缺失必填字段被计入错误", () => {
  const trace = traceOf({
    tools: [
      { id: "1", name: "search", args: { query: "x" }, result: [], ok: true, latencyMs: 1 },
      { id: "2", name: "search", args: {}, result: [], ok: true, latencyMs: 1 },
    ],
  });
  const m = computeMetrics(trace, ["search"], { search: { required: ["query"] } });
  assert.equal(m.paramCorrectness, 0.5);
});

test("成功率：ok=false 的调用被计入失败", () => {
  const trace = traceOf({
    tools: [
      { id: "1", name: "search", args: {}, result: [], ok: true, latencyMs: 1 },
      { id: "2", name: "search", args: {}, result: [], ok: false, latencyMs: 1 },
    ],
  });
  const m = computeMetrics(trace);
  assert.equal(m.successRate, 0.5);
});

test("冗余：相同 (name,args,result) 的重复调用", () => {
  const call = (id: string) => ({
    id,
    name: "search",
    args: { query: "x" },
    result: ["doc1"],
    ok: true,
    latencyMs: 1,
  });
  const trace = traceOf({ tools: [call("1"), call("2"), call("3")] });
  const m = computeMetrics(trace);
  // 3 次完全相同，后 2 次为冗余
  assert.equal(m.stepRedundancy, 2 / 3);
});

test("循环：相同操作在非相邻位置重复（A ... A）", () => {
  const trace = traceOf({
    tools: [
      { id: "1", name: "search", args: { q: "a" }, result: [], ok: true, latencyMs: 1 },
      { id: "2", name: "fetch", args: { q: "b" }, result: [], ok: true, latencyMs: 1 },
      { id: "3", name: "search", args: { q: "a" }, result: [], ok: true, latencyMs: 1 },
    ],
  });
  const m = computeMetrics(trace);
  // search(q=a) 出现在位置 0 和 2，间隔 1 次其它调用 → 循环
  assert.equal(m.loopCount, 1);
});

test("检索命中率：有检索时统计非空比例", () => {
  const trace = traceOf({
    retrievals: [
      { id: "r1", query: "q", returnedDocIds: ["a"] },
      { id: "r2", query: "q", returnedDocIds: [] },
    ],
  });
  const m = computeMetrics(trace);
  assert.equal(m.retrievalHitRate, 0.5);
});

test("token 与延迟求和", () => {
  const trace = traceOf({
    llmSpans: [
      { id: "l1", promptTokens: 10, completionTokens: 5, latencyMs: 100 },
      { id: "l2", promptTokens: 20, completionTokens: 3, latencyMs: 50 },
    ],
    tools: [{ id: "t1", name: "search", args: {}, result: [], ok: true, latencyMs: 30 }],
  });
  const m = computeMetrics(trace);
  assert.equal(m.totalPromptTokens, 30);
  assert.equal(m.totalCompletionTokens, 8);
  assert.equal(m.totalLatencyMs, 180);
});

test("normalizeArgs 键排序保证同语义调用稳定匹配", () => {
  assert.equal(normalizeArgs({ b: 1, a: 2 }), normalizeArgs({ a: 2, b: 1 }));
  assert.notEqual(normalizeArgs({ a: 2, b: 1 }), normalizeArgs({ a: 2, b: 3 }));
});
