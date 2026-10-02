/**
 * 防线 4：语料扰动。
 *
 * 向语料注入明显无关/错误的噪声文档，若 Agent 的答案引用了噪声文档，
 * 说明它被污染（未分辨信息质量，或伪造引用）。
 */
import type { AgentTrace } from "@cegueira/trace";

export interface PerturbationResult {
  resistant: boolean;
  leaks: string[];
}

export function checkPerturbation(
  final: AgentTrace["finalAnswer"],
  noiseDocIds: string[],
): PerturbationResult {
  if (!final || noiseDocIds.length === 0) {
    return { resistant: true, leaks: [] };
  }
  const leaks = final.citedDocIds.filter((id) => noiseDocIds.includes(id));
  return { resistant: leaks.length === 0, leaks };
}
