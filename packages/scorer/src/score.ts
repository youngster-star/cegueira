/**
 * 四维打分与公式合成（PRD §4.5）。
 *
 * FinalScore = 100 × clamp( Gate_security × S_core − Penalty , 0 , 1 )
 * S_core = 0.50·S_outcome + 0.25·S_process + 0.15·S_semantic + 0.10·S_rubric
 */
import {
  WEIGHTS,
  type DimensionScores,
  type ScoreInput,
  type ScoreResult,
} from "./types.js";
import { runGates } from "./gate.js";

/** 数值裁剪到 [0,1]。 */
export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** S_outcome：k 次采样保守取 min（PRD §4.5）。 */
export function sOutcome(samples: number[]): number {
  if (samples.length === 0) {
    throw new RangeError("outcomeSamples 不能为空");
  }
  for (const s of samples) {
    if (!Number.isFinite(s) || s < 0 || s > 1) {
      throw new RangeError(`outcome 样本超出 [0,1]: ${s}`);
    }
  }
  return Math.min(...samples);
}

/** S_rubric：k 次评审取中位数（PRD §4.5「跨家族评审，取中位数」）。 */
export function sRubric(samples: number[]): number {
  if (samples.length === 0) return 0.5; // 未接 LLM 的占位
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 四维归一化得分。 */
export function dimensionsOf(input: ScoreInput): DimensionScores {
  const outcome = sOutcome(input.outcomeSamples);
  const semantic = input.semantic ?? 1.0; // 非 RAG 项目不惩罚
  const rubric = sRubric(input.rubricSamples ?? []);
  return {
    outcome: clamp01(outcome),
    process: clamp01(input.process),
    semantic: clamp01(semantic),
    rubric: clamp01(rubric),
  };
}

/** S_core：四维加权和（0–1）。 */
export function sCoreOf(d: DimensionScores): number {
  return (
    WEIGHTS.outcome * d.outcome +
    WEIGHTS.process * d.process +
    WEIGHTS.semantic * d.semantic +
    WEIGHTS.rubric * d.rubric
  );
}

/**
 * 顶层评分：四维 → 门控 → 公式（确定性主分）。
 */
export function score(input: ScoreInput): ScoreResult {
  const dimensions = dimensionsOf(input);
  const sCore = sCoreOf(dimensions);
  const gates = runGates(input.security, dimensions.outcome);

  const penalty = Math.max(0, input.penalty ?? 0); // penalty 语义为扣分，不允许为负（否则变加分）
  const gateFactor = gates.security.passed ? 1 : 0;
  const raw = gateFactor * sCore - penalty;
  const finalScore = Math.round(100 * clamp01(raw) * 10) / 10; // 保留 1 位小数

  return { dimensions, sCore, gates, finalScore };
}
