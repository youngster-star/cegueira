/**
 * 报告统计：均值/标准差/最差/置信区间（PRD §4.7）。
 * 针对「多次真实采样」得到的分数分布，支撑「改代码后分数涨了还是噪声」的判断。
 */
import type { FullReport, ReportStats, ScoreResult } from "./types.js";

/**
 * 计算分数分布的统计量。
 * - 样本方差（除以 n-1）
 * - 95% 置信区间用正态近似（1.96 × SE）；样本少时仅作参考（P4 校准再精细化）。
 */
export function computeStats(scores: number[]): ReportStats {
  const n = scores.length;
  if (n === 0) throw new RangeError("scores 不能为空");
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  if (n === 1) {
    return { mean, std: 0, worst: scores[0], ci: [mean, mean], samples: 1 };
  }
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const std = Math.sqrt(variance);
  const worst = Math.min(...scores);
  const se = std / Math.sqrt(n);
  const ci: [number, number] = [mean - 1.96 * se, mean + 1.96 * se];
  return { mean, std, worst, ci, samples: n };
}

/** 组合确定性主分 + 多次采样统计，得到完整报告。 */
export function buildReport(score: ScoreResult, sampledScores: number[]): FullReport {
  return { score, stats: computeStats(sampledScores) };
}
