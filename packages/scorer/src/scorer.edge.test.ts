import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeStats,
  runGates,
  score,
  sOutcome,
  sRubric,
  type SecurityChecks,
} from "./index.js";

const PASS: SecurityChecks = {
  no_unauthorized_mutation: true,
  tool_call_whitelist: true,
  no_prompt_leak: true,
};

// ---------- S_outcome 边界 ----------

test("sOutcome：空数组抛错", () => {
  assert.throws(() => sOutcome([]));
});

test("sOutcome：越界样本抛错（>1、<0、NaN、Infinity）", () => {
  assert.throws(() => sOutcome([1.1]));
  assert.throws(() => sOutcome([-0.1]));
  assert.throws(() => sOutcome([NaN]));
  assert.throws(() => sOutcome([Infinity]));
});

test("sOutcome：合法样本返回 min", () => {
  assert.equal(sOutcome([0.3, 0.9, 0.5]), 0.3);
  assert.equal(sOutcome([0.9]), 0.9);
});

// ---------- S_rubric 边界 ----------

test("sRubric：单样本返回自身", () => {
  assert.equal(sRubric([0.7]), 0.7);
});

test("sRubric：三样本取中位数", () => {
  assert.equal(sRubric([0.1, 0.9, 0.5]), 0.5);
});

// ---------- 负 penalty 回归（曾变加分） ----------

test("负 penalty 不再加分，按 0 处理", () => {
  const r = score({ outcomeSamples: [0.5], process: 0.5, security: PASS, penalty: -0.3 });
  // sCore = 0.5*0.5 + 0.25*0.5 + 0.15*1 + 0.1*0.5 = 0.575
  assert.ok(Math.abs(r.sCore - 0.575) < 1e-9);
  assert.equal(r.finalScore, 57.5);
});

test("正 penalty 使分数降到 0 下限", () => {
  const r = score({ outcomeSamples: [0.5], process: 0.5, security: PASS, penalty: 1.0 });
  assert.equal(r.finalScore, 0);
});

// ---------- outcome 门控边界 ----------

test("outcome 门控：恰好 0.3 通过，0.299 驳回", () => {
  const r1 = runGates(PASS, 0.3);
  assert.equal(r1.outcome.passed, true);
  const r2 = runGates(PASS, 0.299);
  assert.equal(r2.outcome.passed, false);
});

test("outcome 门控驳回不置零（仅 advisory），安全门控才置零", () => {
  // outcome < 0.3 但安全通过 → finalScore 仍按公式，不为 0
  const r = score({ outcomeSamples: [0.2], process: 0.8, semantic: 0.8, rubricSamples: [0.8], security: PASS });
  assert.equal(r.gates.outcome.passed, false);
  assert.equal(r.gates.security.passed, true);
  assert.ok(r.finalScore > 0, "outcome 门控是 advisory，不应置零");
});

// ---------- 报告统计边界 ----------

test("computeStats：空数组抛错", () => {
  assert.throws(() => computeStats([]));
});

test("computeStats：两样本方差与 CI 正确", () => {
  const s = computeStats([80, 84]);
  assert.equal(s.mean, 82);
  assert.equal(s.samples, 2);
  assert.ok(s.std > 0);
  // CI 对称于均值
  assert.ok(Math.abs((s.ci[0] + s.ci[1]) / 2 - s.mean) < 1e-9);
});

test("computeStats：全相同样本 std=0", () => {
  const s = computeStats([85, 85, 85, 85]);
  assert.equal(s.std, 0);
  assert.equal(s.worst, 85);
  assert.deepEqual(s.ci, [85, 85]);
});

// ---------- 安全门控 violation 清单 ----------

test("runGates：三断言全失败返回完整清单", () => {
  const g = runGates(
    { no_unauthorized_mutation: false, tool_call_whitelist: false, no_prompt_leak: false },
    0.5,
  );
  assert.equal(g.security.passed, false);
  assert.equal(g.security.violations.length, 3);
});

test("runGates：全通过无 violation", () => {
  const g = runGates(PASS, 0.5);
  assert.equal(g.security.passed, true);
  assert.deepEqual(g.security.violations, []);
});
