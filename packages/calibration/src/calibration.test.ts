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
import { CALIBRATION_TARGETS } from "./types.js";

test("QWK：完全一致 = 1", () => {
  assert.equal(
    quadraticWeightedKappa([1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]),
    1,
  );
});

test("QWK：完全相反接近 -1", () => {
  const q = quadraticWeightedKappa([6, 5, 4, 3, 2, 1], [1, 2, 3, 4, 5, 6]);
  assert.ok(q < -0.9, `应为负且接近 -1，实际 ${q}`);
});

test("QWK：相邻档偏差得到中等一致度", () => {
  // 一半完全一致，一半差一档 → QWK 应在 (0, 1) 之间
  const predicted = [1, 2, 3, 4, 1, 2, 3, 4];
  const human = [1, 2, 3, 4, 2, 3, 4, 5];
  const q = quadraticWeightedKappa(predicted, human, 6);
  assert.ok(q > 0 && q < 1, `QWK 应在 (0,1)，实际 ${q}`);
});

test("QWK：长度不一致抛错", () => {
  assert.throws(() => quadraticWeightedKappa([1, 2], [1]), /长度不一致/);
});

test("QWK：档位越界抛错", () => {
  assert.throws(() => quadraticWeightedKappa([1, 7], [1, 2]), /越界/);
});

test("decisionAccuracy：相邻档判定", () => {
  assert.equal(decisionAccuracy([1, 2, 3], [2, 2, 5]), 2 / 3);
});

test("falseRejectRate：人工及格但预测不及格", () => {
  // human=[3,3,4,2]，predicted=[2,4,4,2]，passLevel=3
  // 人工及格 3 人，其中 1 人被误拒 → 1/3
  assert.equal(falseRejectRate([2, 4, 4, 2], [3, 3, 4, 2], 3), 1 / 3);
});

test("decisionConsistency：重测同档率", () => {
  const paired = [
    { id: "a", first: 2, second: 2 },
    { id: "b", first: 2, second: 3 },
    { id: "c", first: 1, second: 1 },
  ];
  assert.equal(decisionConsistency(paired), 2 / 3);
});

test("stdDev：单样本为 0，多样本正确", () => {
  assert.equal(stdDev([5]), 0);
  assert.ok(Math.abs(stdDev([80, 90]) - Math.sqrt(50)) < 1e-9);
});

test("repeatStdDev：各项目标准差均值与最大", () => {
  const { mean, max } = repeatStdDev([[85, 85, 85], [80, 90]]);
  assert.equal(mean, Math.sqrt(50) / 2);
  assert.equal(max, Math.sqrt(50));
});

test("report：完全一致 + 样本充足 → 通过", () => {
  const samples = Array.from({ length: 200 }, (_, i) => {
    const lv = (i % 6) + 1;
    return { id: `s${i}`, predicted: lv, human: lv };
  });
  const rep = buildCalibrationReport(samples);
  assert.equal(rep.metrics.qwk, 1);
  assert.equal(rep.metrics.decisionAccuracy, 1);
  assert.equal(rep.metrics.falseRejectRate, 0);
  assert.equal(rep.metrics.sampleSize, 200);
  assert.equal(rep.passed, true);
  assert.deepEqual(rep.reasons, []);
});

test("report：QWK 低于硬底线 → 不通过且含硬底线原因", () => {
  const samples = Array.from({ length: 200 }, (_, i) => {
    const pv = (i % 6) + 1;
    return { id: `s${i}`, predicted: pv, human: 7 - pv };
  });
  const rep = buildCalibrationReport(samples);
  assert.ok(rep.metrics.qwk < CALIBRATION_TARGETS.qwkHardFloor);
  assert.equal(rep.passed, false);
  assert.ok(rep.reasons.some((r) => r.includes("硬底线")));
});

test("report：样本量不足 → 含样本量原因", () => {
  const rep = buildCalibrationReport([{ id: "a", predicted: 3, human: 3 }]);
  assert.ok(rep.reasons.some((r) => r.includes("样本量")));
  assert.equal(rep.passed, false);
});

test("isHardFloorPassed：硬底线判定", () => {
  assert.equal(isHardFloorPassed(0.7), true);
  assert.equal(isHardFloorPassed(0.5), false);
});
