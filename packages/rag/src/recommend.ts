/**
 * 方向推荐与阶梯提示的便捷 API（P3 任务 2/3 的复用入口）。
 * 供 packages/contract（方向生成）与 packages/ladder（知识增强）调用。
 */
import type { KnowledgeBase } from "./kb.js";
import { KeywordRetriever } from "./retriever.js";
import {
  UNKNOWN_RESPONSE,
  type DirectionRecommendation,
} from "./types.js";

/** 阶梯提示结果。 */
export interface HintResult {
  answered: boolean;
  /** 命中时取最高分条目的正文，未命中为「不知道」。 */
  text: string;
  /** 命中时的来源（可追溯）。 */
  source?: string;
}

/**
 * 方向推荐：按技能档（0–10 分制）过滤方向模板，全部附来源。
 * 不同技能档会得到不同难度方向（P3 验收）。
 */
export function recommendDirections(
  kb: KnowledgeBase,
  level: number,
): DirectionRecommendation[] {
  const retriever = new KeywordRetriever(kb);
  // 方向推荐以「档位匹配」为准：直接列该档位可上手的全部方向，无需关键词。
  return kb.list({ kind: "direction", level }).map((entry) => ({
    entry,
    difficultyMatched: true,
  }));
}

/** 方向推荐带关键词加权：供「选择方向」时对候选排序。 */
export function rankDirections(
  kb: KnowledgeBase,
  level: number,
  query: string,
): DirectionRecommendation[] {
  const base = recommendDirections(kb, level);
  const retriever = new KeywordRetriever(kb);
  const scored = base.map((rec) => {
    const r = retriever.retrieve(query, { kind: "direction", level });
    const hit = r.hits.find((h) => h.entry.id === rec.entry.id);
    return { rec, score: hit?.score ?? 0 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.rec);
}

/**
 * 阶梯提示：按话题召回知识库提示，未命中返回「不知道」（P3 验收：无幻觉）。
 */
export function getHint(
  kb: KnowledgeBase,
  topic: string,
): HintResult {
  const retriever = new KeywordRetriever(kb);
  const r = retriever.retrieve(topic, { kind: "hint" });
  if (!r.answered) return { answered: false, text: UNKNOWN_RESPONSE };
  const top = r.hits[0].entry;
  return { answered: true, text: top.text, source: top.source };
}
