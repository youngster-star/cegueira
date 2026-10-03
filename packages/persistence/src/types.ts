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

/** 评分记录。 */
export interface ScoreRecord {
  id: string;
  projectId: string;
  finalScore: number;
  sCore: number;
  dimensions: DimensionScores;
  gates: unknown;
  stats: unknown;
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
