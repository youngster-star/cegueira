/**
 * 持久化数据模型（对齐 docs/开发文档.md §7）。
 */

/** 项目记录。 */
export interface ProjectRecord {
  id: string;
  title: string;
  direction: string;
  /** contract.json 快照。 */
  contract: unknown;
  createdAt: string;
  updatedAt: string;
}

/** 四维评分明细。 */
export interface DimensionScores {
  outcome: number;
  process: number;
  semantic: number;
  rubric: number;
}

/** 一次评分所对应的辅助阶梯使用记录（PRD §6.4 硬约束 3）。 */
export interface LadderUsage {
  /** 主动请求 L3 的次数。 */
  l3Requests: number;
  /** 主动请求 L4 的次数。 */
  l4Requests: number;
  /** L4 给出代码后，用户是否已用自己的话解释（未解释则不升级技能分，硬约束 1）。 */
  l4Explained: boolean;
}

/** 评分记录。 */
export interface ScoreRecord {
  id: string;
  projectId: string;
  finalScore: number;
  sCore: number;
  dimensions: DimensionScores;
  gates: unknown;
  /** 报告统计（均值/标准差等）。 */
  stats: unknown;
  /** 辅助阶梯使用记录；缺省表示该次评分未涉阶梯（旧版记录）。 */
  ladder?: LadderUsage;
  createdAt: string;
}

/** 单技能画像。 */
export interface SkillProfile {
  level: number;
  score: number;
  uncertainty: number;
  state: "assessing" | "near_boundary" | "confident";
  percentile: number;
  lastAssessedAt: string;
}

/** 用户画像记录。 */
export interface ProfileRecord {
  id: string;
  skills: Record<string, SkillProfile>;
  ladder: { l3Requests: number; l4Requests: number };
  achievements: { lucidez: boolean };
  updatedAt: string;
}
