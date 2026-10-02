/**
 * 防线 3：数据流断言。
 *
 * 检查答案的引用是否真的来自检索结果或工具返回，而非凭空捏造（伪造引用）。
 */
import type { AgentTrace } from "@cegueira/trace";
import type { DataFlowAssertion } from "./types.js";

/** 尽力从工具返回值中提取 id（对象/数组的 "id" 字段）。 */
export function extractIds(result: unknown): string[] {
  const ids: string[] = [];
  if (Array.isArray(result)) {
    for (const item of result) ids.push(...extractIds(item));
  } else if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (typeof obj.id === "string") ids.push(obj.id);
    for (const v of Object.values(obj)) ids.push(...extractIds(v));
  }
  return ids;
}

/**
 * 校验数据流断言，返回违规项列表（空数组表示全部通过）。
 * 支持的 field：
 * - "answer.cited_doc_ids"：答案引用的文档 id 必须来自检索/工具返回。
 */
export function checkDataFlow(
  trace: AgentTrace,
  assertions: DataFlowAssertion[],
): string[] {
  const violations: string[] = [];
  const final = trace.finalAnswer;

  for (const a of assertions) {
    if (a.field !== "answer.cited_doc_ids") {
      // P2 仅实现 cited_doc_ids 断言，其余字段留待扩展。
      continue;
    }
    if (!final) {
      violations.push(`断言 ${a.field}: 缺少最终答案`);
      continue;
    }
    if (a.source === "retrieval") {
      const retrieved = new Set(
        trace.retrievals.flatMap((r) => r.returnedDocIds),
      );
      for (const id of final.citedDocIds) {
        if (!retrieved.has(id)) {
          violations.push(`引用不存在的文档 "${id}"（未在检索结果中出现）`);
        }
      }
    } else if (a.source === "tool") {
      const toolIds = new Set(trace.tools.flatMap((t) => extractIds(t.result)));
      for (const id of final.citedDocIds) {
        if (!toolIds.has(id)) {
          violations.push(`引用未由工具返回的 id "${id}"`);
        }
      }
    }
  }
  return violations;
}
