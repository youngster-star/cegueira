/**
 * 轨迹效率指标计算（P2 任务 2）。
 *
 * 全部由确定性代码判定，不引入 LLM，保证回放两次指标一致。
 */
import type { AgentTrace, EfficiencyMetrics, ToolSchema } from "./types.js";

/** 稳定序列化参数（键排序），用于相同语义调用的匹配。 */
export function normalizeArgs(args: Record<string, unknown>): string {
  return JSON.stringify(args, Object.keys(args).sort());
}

/** 稳定序列化任意返回值（键排序）。 */
function normalizeResult(result: unknown): string {
  if (result === null || result === undefined) return String(result);
  if (typeof result === "object") {
    try {
      return JSON.stringify(result, Object.keys(result as object).sort());
    } catch {
      return String(result);
    }
  }
  return JSON.stringify(result);
}

/**
 * 计算效率指标。
 * @param trace 结构化轨迹
 * @param declaredTools 契约声明的可用工具名（空数组表示未声明，不惩罚工具选择）
 * @param toolSchemas 各工具的必填参数 schema（缺省视为无法判定，不惩罚参数）
 */
export function computeMetrics(
  trace: AgentTrace,
  declaredTools: string[] = [],
  toolSchemas: Record<string, ToolSchema> = {},
): EfficiencyMetrics {
  const tools = trace.tools;
  const steps = tools.length;

  // 1. 工具选择准确率：未声明工具的调用视为「选错工具」。
  let accurate = 0;
  for (const t of tools) {
    if (declaredTools.length === 0 || declaredTools.includes(t.name)) accurate++;
  }
  const toolChoiceAccuracy = steps === 0 ? 1 : accurate / steps;

  // 2. 参数正确率：声明了必填字段的工具，检查是否全部提供。
  let paramOk = 0;
  let paramChecked = 0;
  for (const t of tools) {
    const schema = toolSchemas[t.name];
    if (!schema || schema.required.length === 0) continue;
    paramChecked++;
    if (schema.required.every((k) => k in t.args)) paramOk++;
  }
  const paramCorrectness = paramChecked === 0 ? 1 : paramOk / paramChecked;

  // 3. 成功率。
  const successRate = steps === 0 ? 1 : tools.filter((t) => t.ok).length / steps;

  // 4. 冗余：相同 (name, args, result) 的重复调用（做了重复劳动）。
  const seen = new Map<string, number>();
  let redundant = 0;
  for (const t of tools) {
    const key = `${t.name}|${normalizeArgs(t.args)}|${normalizeResult(t.result)}`;
    const count = seen.get(key) ?? 0;
    if (count > 0) redundant++;
    seen.set(key, count + 1);
  }
  const stepRedundancy = steps === 0 ? 0 : redundant / steps;

  // 5. 循环：相同 (name, args) 在非相邻位置重复出现（A ... A，中间夹了其它调用）。
  const positions = new Map<string, number[]>();
  tools.forEach((t, i) => {
    const key = `${t.name}|${normalizeArgs(t.args)}`;
    const arr = positions.get(key) ?? [];
    arr.push(i);
    positions.set(key, arr);
  });
  let loopCount = 0;
  for (const arr of positions.values()) {
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] - arr[i - 1] > 1) loopCount++;
    }
  }

  // 6. 检索命中率。
  const retrievals = trace.retrievals;
  let retrievalHitRate: number | null = null;
  if (retrievals.length > 0) {
    const hits = retrievals.filter((r) => r.returnedDocIds.length > 0).length;
    retrievalHitRate = hits / retrievals.length;
  }

  // 7. token 与延迟。
  const totalPromptTokens = trace.llmSpans.reduce((a, s) => a + s.promptTokens, 0);
  const totalCompletionTokens = trace.llmSpans.reduce(
    (a, s) => a + s.completionTokens,
    0,
  );
  const totalLatencyMs =
    trace.llmSpans.reduce((a, s) => a + s.latencyMs, 0) +
    tools.reduce((a, t) => a + t.latencyMs, 0);

  return {
    steps,
    toolChoiceAccuracy,
    paramCorrectness,
    successRate,
    stepRedundancy,
    loopCount,
    retrievalHitRate,
    totalPromptTokens,
    totalCompletionTokens,
    totalLatencyMs,
  };
}
