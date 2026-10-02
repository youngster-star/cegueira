import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMetrics } from "./metrics.js";
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

test("未声明工具集时工具选择不惩罚", () => {
  const trace = traceOf({
    tools: [{ id: "1", name: "any_tool", args: {}, result: null, ok: true, latencyMs: 1 }],
  });
  const m = computeMetrics(trace, []); // 空声明 = 不惩罚
  assert.equal(m.toolChoiceAccuracy, 1);
});

test("相邻重复不算循环（A A 是冗余不是循环）", () => {
  const call = (id: string) => ({
    id,
    name: "search",
    args: { q: "a" },
    result: [],
    ok: true,
    latencyMs: 1,
  });
  const trace = traceOf({ tools: [call("1"), call("2")] });
  const m = computeMetrics(trace);
  assert.equal(m.loopCount, 0);
  assert.equal(m.stepRedundancy, 0.5);
});

test("循环检测区分参数（同名不同参不算循环）", () => {
  const trace = traceOf({
    tools: [
      { id: "1", name: "search", args: { q: "a" }, result: [], ok: true, latencyMs: 1 },
      { id: "2", name: "fetch", args: { q: "b" }, result: [], ok: true, latencyMs: 1 },
      { id: "3", name: "search", args: { q: "c" }, result: [], ok: true, latencyMs: 1 },
    ],
  });
  const m = computeMetrics(trace);
  assert.equal(m.loopCount, 0, "不同参数的 search 不应视为循环");
});

test("冗余要求 name+args+result 三者都相同", () => {
  const trace = traceOf({
    tools: [
      { id: "1", name: "search", args: { q: "a" }, result: ["doc1"], ok: true, latencyMs: 1 },
      { id: "2", name: "search", args: { q: "a" }, result: ["doc2"], ok: true, latencyMs: 1 },
    ],
  });
  const m = computeMetrics(trace);
  assert.equal(m.stepRedundancy, 0, "结果不同不算冗余");
});

test("仅有工具无 LLM span 时 token 为 0、latency 只计工具", () => {
  const trace = traceOf({
    tools: [{ id: "1", name: "search", args: {}, result: [], ok: true, latencyMs: 30 }],
  });
  const m = computeMetrics(trace);
  assert.equal(m.totalPromptTokens, 0);
  assert.equal(m.totalCompletionTokens, 0);
  assert.equal(m.totalLatencyMs, 30);
});

test("参数正确率：无 schema 声明不计入分母（不惩罚）", () => {
  const trace = traceOf({
    tools: [{ id: "1", name: "search", args: {}, result: [], ok: true, latencyMs: 1 }],
  });
  const m = computeMetrics(trace, ["search"], {}); // 无 schema
  assert.equal(m.paramCorrectness, 1);
});

test("参数正确率：schema 声明空 required 列表视为无法判定", () => {
  const trace = traceOf({
    tools: [{ id: "1", name: "search", args: {}, result: [], ok: true, latencyMs: 1 }],
  });
  const m = computeMetrics(trace, ["search"], { search: { required: [] } });
  assert.equal(m.paramCorrectness, 1);
});

test("检索命中率：多次检索统计非空比例", () => {
  const trace = traceOf({
    retrievals: [
      { id: "r1", query: "q", returnedDocIds: ["a"] },
      { id: "r2", query: "q", returnedDocIds: ["b", "c"] },
      { id: "r3", query: "q", returnedDocIds: [] },
    ],
  });
  assert.equal(computeMetrics(trace).retrievalHitRate, 2 / 3);
});

test("综合轨迹：工具选择+参数+成功率+冗余+循环同时判定", () => {
  const trace = traceOf({
    tools: [
      { id: "1", name: "search", args: { query: "x" }, result: [], ok: true, latencyMs: 1 },
      { id: "2", name: "drop_table", args: {}, result: null, ok: false, latencyMs: 1 },
      { id: "3", name: "search", args: { query: "x" }, result: [], ok: true, latencyMs: 1 },
    ],
  });
  const m = computeMetrics(trace, ["search"], { search: { required: ["query"] } });
  // 工具选择：2/3（drop_table 未声明）
  assert.equal(m.toolChoiceAccuracy, 2 / 3);
  // 参数：search 两次都带 query（drop_table 无 schema）→ 1
  assert.equal(m.paramCorrectness, 1);
  // 成功率：2/3
  assert.equal(m.successRate, 2 / 3);
  // 冗余：search(query=x) 重复一次（第 3 次相对第 1 次）→ 1/3
  assert.equal(m.stepRedundancy, 1 / 3);
  // 循环：search(query=x) 位置 0 和 2 间隔 drop_table → 1
  assert.equal(m.loopCount, 1);
});
