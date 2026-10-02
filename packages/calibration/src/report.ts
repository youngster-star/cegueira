/**
 * 校准报告（P4 任务 3/4）：汇总指标、判定达标、硬底线禁用。
 */
import {
  decisionAccuracy,
  decisionConsistency,
  falseRejectRate,
  quadraticWeightedKappa,
  repeatStdDev,
} from "./metrics.js";
import {
  CALIBRATION_TARGETS,
  PASS_LEVEL,
  type CalibrationReport,
  type CalibrationSample,
  type RepeatedSample,
} from "./types.js";

/** 构建完整校准报告。 */
export function buildCalibrationReport(
  samples: CalibrationSample[],
  repeated?: RepeatedSample[],
  repeatScores?: number[][],
): CalibrationReport {
  if (samples.length === 0) {
    throw new RangeError("校准样本不能为空");
  }
  const predicted = samples.map((s) => s.predicted);
  const human = samples.map((s) => s.human);

  const qwk = quadraticWeightedKappa(predicted, human);
  const accuracy = decisionAccuracy(predicted, human);
  const reject = falseRejectRate(predicted, human, PASS_LEVEL);
  const consistency = repeated ? decisionConsistency(repeated) : 1; // 未提供重测数据则不扣分
  const std = repeatScores ? repeatStdDev(repeatScores) : { mean: 0, max: 0 };

  const checks: Record<string, boolean> = {
    qwk_target: qwk >= CALIBRATION_TARGETS.qwkTarget,
    qwk_hard_floor: qwk >= CALIBRATION_TARGETS.qwkHardFloor,
    decision_accuracy: accuracy >= CALIBRATION_TARGETS.decisionAccuracyTarget,
    decision_consistency: consistency >= CALIBRATION_TARGETS.decisionConsistencyTarget,
    false_reject: reject <= CALIBRATION_TARGETS.falseRejectMax,
    repeat_stddev: std.max <= CALIBRATION_TARGETS.repeatStdDevMax,
    sample_size: samples.length >= CALIBRATION_TARGETS.minSampleSize,
  };

  const reasons: string[] = [];
  if (!checks.qwk_hard_floor) reasons.push("QWK 低于硬底线 0.60");
  if (!checks.qwk_target) reasons.push("QWK 未达目标 0.70");
  if (!checks.decision_accuracy) reasons.push("决策准确性未达 0.80");
  if (!checks.decision_consistency) reasons.push("决策一致性未达 0.75");
  if (!checks.false_reject) reasons.push("误拒率超过 3%");
  if (!checks.repeat_stddev) reasons.push("重复评分标准差超过 3 分");
  if (!checks.sample_size) reasons.push("校准样本量不足 200 条");

  // 硬底线（QWK < 0.60）→ 评分功能禁用（passed=false 且不启用）
  const passed = checks.qwk_hard_floor && reasons.length === 0;

  return {
    metrics: { qwk, decisionAccuracy: accuracy, falseRejectRate: reject, sampleSize: samples.length },
    decisionConsistency: consistency,
    repeatStdDev: std,
    checks,
    passed,
    reasons,
  };
}

/** 是否达到硬底线（QWK < 0.60 则禁用评分，P4 验收：低于硬底线自动禁用）。 */
export function isHardFloorPassed(qwk: number): boolean {
  return qwk >= CALIBRATION_TARGETS.qwkHardFloor;
}
