/** 不确定度与三态显示（PRD §5.2 / §5.6）。 */
import { levelOf } from "./levels.js";

export type ProfileState = "assessing" | "near_boundary" | "confident";

export interface UncertaintyParams {
  base: number; // 基础不确定度
  lambda: number; // 每天回升系数（遗忘）
  uHigh: number; // 评估中阈值
  epsilon: number; // 边界接近阈值
}

export const DEFAULT_PARAMS: UncertaintyParams = {
  base: 1.0,
  lambda: 0.02,
  uHigh: 0.5,
  epsilon: 0.3,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 不确定度：样本越少、越久未评估，越高（PRD §5.6 用不确定度回升代替分数衰减）。
 */
export function uncertainty(
  nSamples: number,
  lastAssessedAt: Date,
  now: Date,
  p: UncertaintyParams = DEFAULT_PARAMS,
): number {
  const days = Math.max(0, (now.getTime() - lastAssessedAt.getTime()) / DAY_MS);
  return p.base / (1 + nSamples) + p.lambda * days;
}

/** 是否接近档位边界（用于「上升中」描边）。 */
export function isNearBoundary(
  score: number,
  p: UncertaintyParams = DEFAULT_PARAMS,
): boolean {
  const lvl = levelOf(score);
  return score - lvl.min < p.epsilon || lvl.max - score < p.epsilon;
}

/** 三态判定：评估中 → 接近边界 → 确定。 */
export function stateOf(
  score: number,
  u: number,
  p: UncertaintyParams = DEFAULT_PARAMS,
): ProfileState {
  if (u > p.uHigh) return "assessing";
  if (isNearBoundary(score, p)) return "near_boundary";
  return "confident";
}
