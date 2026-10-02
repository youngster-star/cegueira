/**
 * P4 校准：评分 ↔ 人工一致性指标类型与目标阈值（PRD §4.9 / P4 阶段）。
 *
 * 档位约定：1–6 档（对应 profile 的六档）；分数约定：0–100 分。
 */

/** 单条人工标注：预测档 vs 人工档（1–6）。 */
export interface CalibrationSample {
  id: string;
  predicted: number;
  human: number;
}

/** 重测配对：同一项目两次评分落在的档位。 */
export interface RepeatedSample {
  id: string;
  first: number;
  second: number;
}

/** 校准目标阈值（PRD §4.9）。 */
export const CALIBRATION_TARGETS = {
  /** QWK 目标。 */
  qwkTarget: 0.7,
  /** QWK 硬底线（低于则评分功能不启用）。 */
  qwkHardFloor: 0.6,
  /** 决策一致性（重测同档率）目标。 */
  decisionConsistencyTarget: 0.75,
  /** 决策准确性（相邻档）目标。 */
  decisionAccuracyTarget: 0.8,
  /** 误拒率上限。 */
  falseRejectMax: 0.03,
  /** 重复评分标准差上限（分）。 */
  repeatStdDevMax: 3,
  /** 校准样本量下限。 */
  minSampleSize: 200,
} as const;

/** 及格档位（≥ 此档视为「合格」，用于误拒率）。 */
export const PASS_LEVEL = 3;

export interface CalibrationMetrics {
  /** 二次加权 Kappa（-1 ~ 1）。 */
  qwk: number;
  /** 决策准确性：|pred - human| ≤ 1 的比例。 */
  decisionAccuracy: number;
  /** 误拒率：人工及格但预测不及格的比例。 */
  falseRejectRate: number;
  /** 样本量。 */
  sampleSize: number;
}

export interface CalibrationReport {
  metrics: CalibrationMetrics;
  /** 重测同档率（决策一致性）。 */
  decisionConsistency: number;
  /** 重复评分标准差（均值 / 最大）。 */
  repeatStdDev: { mean: number; max: number };
  /** 各项是否达标。 */
  checks: Record<string, boolean>;
  /** 是否整体通过（硬底线 + 全部目标）。 */
  passed: boolean;
  /** 未达标项说明。 */
  reasons: string[];
}
