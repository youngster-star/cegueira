import { strict as assert } from "node:assert";
import { test } from "node:test";
import { sProcess, sSemantic } from "./process.js";
import type { EfficiencyMetrics } from "@cegueira/trace";

function metricsOf(overrides: Partial<EfficiencyMetrics>): EfficiencyMetrics {
  return {
    steps: 1,
    toolChoiceAccuracy: 1,
    paramCorrectness: 1,
    successRate: 1,
    stepRedundancy: 0,
    loopCount: 0,
    retrievalHitRate: null,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalLatencyMs: 0,
    ...overrides,
  };
}

test("完美轨迹 S_process = 1", () => {
  assert.equal(sProcess(metricsOf({})), 1);
});

test("工具选择错误降低 S_process", () => {
  const s = sProcess(metricsOf({ toolChoiceAccuracy: 0.5 }));
  assert.ok(s < 1 && s > 0);
  // 0.4*0.5 + 0.35*1 + 0.25*1 = 0.8
  assert.equal(s, 0.8);
});

test("循环触发 0.3 惩罚", () => {
  const s = sProcess(metricsOf({ loopCount: 1 }));
  // 1 - 0.3 = 0.7
  assert.equal(s, 0.7);
});

test("冗余按比例惩罚", () => {
  const s = sProcess(metricsOf({ stepRedundancy: 0.5 }));
  // 1 - 0.2*0.5 = 0.9
  assert.equal(s, 0.9);
});

test("S_process 下限裁剪到 0", () => {
  const s = sProcess(
    metricsOf({ toolChoiceAccuracy: 0, paramCorrectness: 0, successRate: 0, stepRedundancy: 1, loopCount: 1 }),
  );
  assert.equal(s, 0);
});

test("非 RAG 项目 S_semantic 不惩罚", () => {
  assert.equal(sSemantic(null), 1.0);
});

test("检索命中率映射到 S_semantic", () => {
  assert.equal(sSemantic(0.6), 0.6);
  assert.equal(sSemantic(1.5), 1); // 裁剪
  assert.equal(sSemantic(-0.1), 0); // 裁剪
});
