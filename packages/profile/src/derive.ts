/**
 * 由评分聚合出技能画像（PRD §5）：把某技能维度下的历次 FinalScore（0–100）
 * 收敛为一个 0–10 的技能分 + 档位 + 不确定度 + 三态。
 *
 * 设计取舍：
 * - **取均值**而非最差/中位数：画像要反映「当前稳定水平」，最差值是门控口径，
 *   不是画像口径；多次评分会自然平滑。
 * - **不确定度随样本数与时间回升**（PRD §5.6）：不衰减分数，只回升不确定度。
 * - 技能维度的**命名与归类**由调用方决定（本包不做 taxonomy 假设），因此入参
 *   直接给 skill 名与属于它的分数列表。
 */
import { levelOf, SCORE_MAX } from "./levels.js";
import {
  DEFAULT_PARAMS,
  stateOf,
  uncertainty,
  type ProfileState,
  type UncertaintyParams,
} from "./uncertainty.js";

/** 单个技能画像（与持久化 SkillProfile 结构兼容）。 */
export interface SkillProfile {
  level: number;
  score: number; // 0–10
  uncertainty: number;
  state: ProfileState;
  lastAssessedAt: string; // ISO
}

export interface AggregateSkillInput {
  skill: string;
  /** 该技能维度下的历次 FinalScore（0–100）。 */
  finalScores: number[];
  /** 最近一次评估时间（ISO）。 */
  lastAssessedAt: string;
  /** 「当前」时间（ISO），测试用；缺省取系统时间。 */
  now?: string;
  params?: UncertaintyParams;
}

/** 聚合单技能画像。 */
export function aggregateSkill(input: AggregateSkillInput): {
  skill: string;
  profile: SkillProfile;
} {
  if (input.finalScores.length === 0) {
    throw new RangeError("finalScores 不能为空");
  }
  for (const s of input.finalScores) {
    if (!Number.isFinite(s) || s < 0 || s > 100) {
      throw new RangeError(`finalScore 越界 [0,100]: ${s}`);
    }
  }
  const params = input.params ?? DEFAULT_PARAMS;
  const mean = input.finalScores.reduce((a, b) => a + b, 0) / input.finalScores.length;
  const score = Math.min(SCORE_MAX, mean / 10);
  const now = input.now === undefined ? new Date() : new Date(input.now);
  const last = new Date(input.lastAssessedAt);
  const u = uncertainty(input.finalScores.length, last, now, params);
  const state = stateOf(score, u, params);

  return {
    skill: input.skill,
    profile: {
      level: levelOf(score).level,
      score: Math.round(score * 100) / 100,
      uncertainty: Math.round(u * 1000) / 1000,
      state,
      lastAssessedAt: input.lastAssessedAt,
    },
  };
}

/** 是否进入「掌握」档（用于 Lucidez 成就，PRD §2 / §5.1「基本掌握」起算）。 */
export function isLucidez(level: number): boolean {
  return level >= 3;
}
