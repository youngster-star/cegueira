/**
 * 阶梯知识增强（P3 任务 3）：L2/L3 提示从知识库召回，附引用，未命中说「不知道」。
 */
import {
  KnowledgeBase,
  getHint,
  type HintResult,
} from "@cegueira/rag";

/** 按话题召回阶梯提示；未命中返回「不知道」（减少模型幻觉）。 */
export function knowledgeHint(topic: string): HintResult {
  return getHint(KnowledgeBase.fromSeed(), topic);
}
