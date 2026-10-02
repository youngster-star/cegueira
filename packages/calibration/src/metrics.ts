/**
 * 校准指标计算（P4 任务 2）：QWK / 决策准确性 / 误拒率 / 决策一致性 / 重复标准差。
 * 全部纯代码、确定性可复现。
 */
import {
  CALIBRATION_TARGETS,
  PASS_LEVEL,
  type RepeatedSample,
} from "./types.js";

/** 档位校验：1–nLevels 的整数。 */
function assertLevels(values: number[], nLevels: number, label: string): void {
  for (const v of values) {
    if (!Number.isInteger(v) || v < 1 || v > nLevels) {
      throw new RangeError(`${label} 档位越界 [1,${nLevels}]: ${v}`);
    }
  }
}

/**
 * 二次加权 Kappa（Quadratic Weighted Kappa，QWK）。
 * 权重 W[i][j] = (i-j)^2 / (k-1)^2；kappa = 1 - ΣΣW·O / ΣΣW·E。
 */
export function quadraticWeightedKappa(
  predicted: number[],
  human: number[],
  nLevels = 6,
): number {
  if (predicted.length !== human.length) {
    throw new Error("predicted 与 human 长度不一致");
  }
  if (predicted.length === 0) {
    throw new RangeError("样本不能为空");
  }
  assertLevels(predicted, nLevels, "predicted");
  assertLevels(human, nLevels, "human");

  const k = nLevels;
  const N = predicted.length;
  const O = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let i = 0; i < N; i++) {
    O[predicted[i] - 1][human[i] - 1]++;
  }

  const rowSum = O.map((row) => row.reduce((a, b) => a + b, 0));
  const colSum = Array.from({ length: k }, (_, j) =>
    O.reduce((a, row) => a + row[j], 0),
  );

  let num = 0;
  let den = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const w = ((i - j) * (i - j)) / ((k - 1) * (k - 1));
      num += w * O[i][j];
      den += w * (rowSum[i] * colSum[j]) / N;
    }
  }
  if (den === 0) return 1; // 无分歧 → 完全一致
  return 1 - num / den;
}

/** 决策准确性：预测档与人工档相差 ≤ 1 的比例。 */
export function decisionAccuracy(
  predicted: number[],
  human: number[],
): number {
  if (predicted.length !== human.length) {
    throw new Error("predicted 与 human 长度不一致");
  }
  if (predicted.length === 0) throw new RangeError("样本不能为空");
  let ok = 0;
  for (let i = 0; i < predicted.length; i++) {
    if (Math.abs(predicted[i] - human[i]) <= 1) ok++;
  }
  return ok / predicted.length;
}

/** 误拒率：人工及格（≥ passLevel）但预测不及格（< passLevel）的比例。 */
export function falseRejectRate(
  predicted: number[],
  human: number[],
  passLevel = PASS_LEVEL,
): number {
  if (predicted.length !== human.length) {
    throw new Error("predicted 与 human 长度不一致");
  }
  let humanPass = 0;
  let falselyRejected = 0;
  for (let i = 0; i < predicted.length; i++) {
    if (human[i] >= passLevel) {
      humanPass++;
      if (predicted[i] < passLevel) falselyRejected++;
    }
  }
  return humanPass === 0 ? 0 : falselyRejected / humanPass;
}

/** 决策一致性（重测同档率）：两次评分落同一档的比例。 */
export function decisionConsistency(samples: RepeatedSample[]): number {
  if (samples.length === 0) throw new RangeError("样本不能为空");
  let same = 0;
  for (const s of samples) {
    if (s.first === s.second) same++;
  }
  return same / samples.length;
}

/** 样本标准差（无偏，n-1）。 */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sq = values.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  return Math.sqrt(sq / (values.length - 1));
}

/** 重复评分标准差：每个项目多次评分（0–100 分），返回各项目标准差的均值与最大值。 */
export function repeatStdDev(scores: number[][]): { mean: number; max: number } {
  if (scores.length === 0) return { mean: 0, max: 0 };
  const stds = scores.map((s) => stdDev(s));
  const mean = stds.reduce((a, b) => a + b, 0) / stds.length;
  return { mean, max: Math.max(...stds) };
}

/** 阈值是否满足（导出供报告/CI 使用）。 */
export function meetsThresholds(
  qwk: number,
  accuracy: number,
  rejectRate: number,
): { qwkPassed: boolean; accuracyPassed: boolean; rejectPassed: boolean } {
  return {
    qwkPassed: qwk >= CALIBRATION_TARGETS.qwkHardFloor,
    accuracyPassed: accuracy >= CALIBRATION_TARGETS.decisionAccuracyTarget,
    rejectPassed: rejectRate <= CALIBRATION_TARGETS.falseRejectMax,
  };
}
