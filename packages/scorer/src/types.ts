/**
 * 评分引擎类型定义（PRD §4.5 / 开发文档 §9.3）。
 *
 * 输入为「已由轨迹分析器算出的维度信号」，评分引擎负责：
 * 四维打分 → 公式合成 → 门控 → 报告统计。
 * 维度信号的计算（从录制回放轨迹 + acceptance 断言求值）在 P2 完成。
 */

/** 四维权重（PRD §4.5，固定不变）。 */
export const WEIGHTS = {
  outcome: 0.5,
  process: 0.25,
  semantic: 0.15,
  rubric: 0.1,
} as const;

/** 安全三断言（PRD §4.6）。 */
export interface SecurityChecks {
  no_unauthorized_mutation: boolean;
  tool_call_whitelist: boolean;
  no_prompt_leak: boolean;
}

/** 门控阈值。 */
export const OUTCOME_MIN_GATE = 0.3;

/** 评分输入。 */
export interface ScoreInput {
  /**
   * S_outcome 的 k 次采样（每次为终止态断言通过率，0–1）。
   * 保守取 min（PRD §4.5「k=3 取 min」）。
   */
  outcomeSamples: number[];
  /** S_process：工具选择/参数/成功率，纯代码判定（0–1）。 */
  process: number;
  /** S_semantic：RAG 三元组一致性（0–1）；非 RAG 项目可省略（置 1.0）。 */
  semantic?: number;
  /**
   * S_rubric 的 k 次 LLM 评审分（0–1），取中位数（PRD §4.5「k=3 取中位数」）。
   * 缺省时视为 0.5（P1 未接 LLM 的占位）。
   */
  rubricSamples?: number[];
  /** 安全三断言结果。 */
  security: SecurityChecks;
  /** 惩罚项（循环、token 超预算等），从 S_core 扣除（PRD §4.5 Penalty）。 */
  penalty?: number;
}

/** 四维得分（0–1）。 */
export interface DimensionScores {
  outcome: number;
  process: number;
  semantic: number;
  rubric: number;
}

/** 门控结果。 */
export interface GateResult {
  security: { passed: boolean; violations: string[] };
  outcome: { passed: boolean; min: number };
}

/** 报告统计（均值/标准差/最差/置信区间）。 */
export interface ReportStats {
  mean: number;
  std: number;
  worst: number;
  ci: [number, number];
  samples: number;
}

/**
 * 评分结果（确定性主分）。
 * 报告统计（均值/标准差/最差/CI）由 computeStats 对「多次真实采样」单独计算，
 * 不与主分混在一起（PRD §4.7 / 开发文档 §8.3 步骤 6）。
 */
export interface ScoreResult {
  dimensions: DimensionScores;
  sCore: number; // 0–1
  gates: GateResult;
  finalScore: number; // 0–100
}

/** 完整报告 = 确定性主分 + 多次采样统计。 */
export interface FullReport {
  score: ScoreResult;
  stats: ReportStats;
}
