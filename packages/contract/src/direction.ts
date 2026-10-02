/**
 * 方向生成接入 RAG（P3 任务 2）：根据技能档推荐可上手方向，附引用来源。
 * 供 CLI / GUI 的「方向选择」屏调用；generateBundle 保持向后兼容。
 */
import {
  KnowledgeBase,
  rankDirections,
  recommendDirections as ragRecommend,
  type DirectionRecommendation,
} from "@cegueira/rag";

/**
 * 推荐项目方向：按技能档（0–10 分制）过滤；给定偏好词则按关键词排序。
 * 返回结果附引用来源，难度与技能档匹配（P3 验收）。
 */
export function recommendDirections(
  level: number,
  preference?: string,
): DirectionRecommendation[] {
  const kb = KnowledgeBase.fromSeed();
  if (preference && preference.trim()) {
    return rankDirections(kb, level, preference);
  }
  return ragRecommend(kb, level);
}
