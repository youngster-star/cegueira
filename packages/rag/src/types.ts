/**
 * P3 自身 RAG：知识库条目与检索结果类型（PRD 开发文档 / P3 阶段）。
 *
 * 语料来源：方向模板（direction）与阶梯提示（hint），
 * 每条都带 tags、难度档（levelMin/levelMax，0–10 分制）与可追溯 source。
 */
export type EntryKind = "direction" | "hint";

export interface KnowledgeEntry {
  id: string;
  text: string;
  source: string;
  tags: string[];
  kind: EntryKind;
  /** 技能档下限（0–10 分制，含）。缺省不限。 */
  levelMin?: number;
  /** 技能档上限（0–10 分制，含）。缺省不限。 */
  levelMax?: number;
}

/** 命中条目（带匹配得分）。 */
export interface RetrievedEntry {
  entry: KnowledgeEntry;
  score: number;
}

/** 检索结果。answered=false 时应回退「不知道」，不带入模型先验。 */
export interface RetrievalResult {
  hits: RetrievedEntry[];
  answered: boolean;
}

/** 未命中时的兜底答复（PRD P3 验收：知识库外的问题明确说「不知道」）。 */
export const UNKNOWN_RESPONSE = "不知道";

/** 方向推荐结果（附引用来源，PRD P3 验收：推荐可追溯）。 */
export interface DirectionRecommendation {
  entry: KnowledgeEntry;
  /** 难度是否匹配当前技能档。 */
  difficultyMatched: boolean;
}
