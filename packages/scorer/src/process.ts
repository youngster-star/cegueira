/**
 * S_process / S_semantic 落地（P2 任务 4 / 开发文档 §9.3）。
 *
 * 由轨迹效率指标（packages/trace）聚合为 0–1 的过程分，纯代码判定，
 * 不引入 LLM（核心原则：「LLM 只说话，不打分」）。
 */
import type { EfficiencyMetrics } from "@cegueira/trace";
import { clamp01 } from "./score.js";

/**
 * S_process（权重 0.25）：工具选择 / 参数 / 成功率 + 冗余与循环惩罚。
 *
 * 基分 = 0.40·工具选择准确率 + 0.35·参数正确率 + 0.25·成功率
 * 惩罚 = 0.20·冗余率 + （存在循环 ? 0.30 : 0）
 */
export function sProcess(m: EfficiencyMetrics): number {
  const base =
    0.4 * m.toolChoiceAccuracy + 0.35 * m.paramCorrectness + 0.25 * m.successRate;
  const penalty = 0.2 * m.stepRedundancy + (m.loopCount > 0 ? 0.3 : 0);
  return clamp01(base - penalty);
}

/**
 * S_semantic（权重 0.15）：RAG 检索命中率作为一致性信号。
 * 无检索调用（非 RAG 项目）时返回 1.0，不惩罚。
 */
export function sSemantic(retrievalHitRate: number | null): number {
  if (retrievalHitRate === null) return 1.0;
  return clamp01(retrievalHitRate);
}
