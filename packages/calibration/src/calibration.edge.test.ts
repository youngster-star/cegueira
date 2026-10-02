import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decisionAccuracy,
  decisionConsistency,
  falseRejectRate,
  quadraticWeightedKappa,
  repeatStdDev,
  stdDev,
} from "./metrics.js";
import { buildCalibrationReport, isHardFloorPassed } from "./report.js";

test("decisionAccuracy：档位越界抛错（回归，与 QWK 风格一致）", () => {
  assert.throws(() => decisionAccuracy([1, 99], [1, 2]), /越界/);
  assert.throws(() => decisionAccuracy([1, 2], [1, 0]), /越界/);
});

test("falseRejectRate：档位越界抛错（回归）", () => {
  assert.throws(() => falseRejectRate([1, 7], [1, 2]), /越界/);
});

test("decisionAccuracy：长度不一致抛错", () => {
  assert.throws(() => decisionAccuracy([1, 2], [1]), /长度不一致/);
});

test("falseRejectRate：长度不一致抛错", () => {
  assert.throws(() => falseRejectRate([1], [1, 2]), /长度不一致/);
});

test("QWK：系统性偏移 +1 档为正值且 < 1", () => {
  const pred = [2, 3, 4, 5, 6, 6];
  const hum = [1, 2, 3, 4, 5, 5];
  const q = quadraticWeightedKappa(pred, hum, 6);
  assert.ok(q > 0 && q < 1, `系统性偏移 QWK 应在 (0,1)，实际 ${q}`);
});

test("QWK：全偏移（全 3 vs 全 4）= 0", () => {
  assert.equal(quadraticWeightedKappa([3, 3, 3, 3], [4, 4, 4, 4], 6), 0);
});

test("QWK：全一致但集中在单一档 = 1（den=0 分支）", () => {
  assert.equal(quadraticWeightedKappa([3, 3, 3, 3], [3, 3, 3, 3], 6), 1);
});

test("falseRejectRate：无人及格返回 0（不除零）", () => {
  assert.equal(falseRejectRate([1, 1], [1, 2], 3), 0);
});

test("decisionConsistency：空样本抛错", () => {
  assert.throws(() => decisionConsistency([]), /样本不能为空/);
});

test("stdDev：空数组与单样本返回 0", () => {
  assert.equal(stdDev([]), 0);
  assert.equal(stdDev([42]), 0);
});

test("repeatStdDev：空项目列表返回全 0", () => {
  assert.deepEqual(repeatStdDev([]), { mean: 0, max: 0 });
});

test("repeatStdDev：含空评分数组不崩溃", () => {
  const r = repeatStdDev([[85], []]);
  assert.equal(r.mean, 0);
  assert.equal(r.max, 0);
});

test("buildCalibrationReport：空 repeated 数组抛错（而非静默给 1）", () => {
  assert.throws(
    () => buildCalibrationReport([{ id: "a", predicted: 3, human: 3 }], []),
    /样本不能为空/,
  );
});

test("buildCalibrationReport：未提供 repeated/repeatScores 不扣分", () => {
  const samples = Array.from({ length: 200 }, (_, i) => {
    const lv = (i % 6) + 1;
    return { id: `s${i}`, predicted: lv, human: lv };
  });
  const rep = buildCalibrationReport(samples);
  assert.equal(rep.decisionConsistency, 1, "未提供重测默认 1");
  assert.deepEqual(rep.repeatStdDev, { mean: 0, max: 0 });
  assert.equal(rep.passed, true);
});

test("buildCalibrationReport：repeatScores 标准差超标 → 不通过", () => {
  const samples = Array.from({ length: 200 }, (_, i) => {
    const lv = (i % 6) + 1;
    return { id: `s${i}`, predicted: lv, human: lv };
  });
  // 某项目重复评分波动 10 分 > 3 分上限
  const rep = buildCalibrationReport(samples, undefined, [[80, 90, 85]]);
  assert.equal(rep.checks.repeat_stddev, false);
  assert.ok(rep.reasons.some((r) => r.includes("标准差")));
});

test("isHardFloorPassed：精确边界 0.6", () => {
  assert.equal(isHardFloorPassed(0.6), true);
  assert.equal(isHardFloorPassed(0.5999), false);
});
