/**
 * 事实词汇表（A1）。
 *
 * 契约里的 assert 表达式只能引用本文件 `TraceFacts` 声明的标识符，
 * 而这些标识符**全部由 AgentTrace 推导得出**。这是本模块最重要的设计约束：
 *
 *   **绝不接受用户 Agent 自报的数值。**
 *
 * 理由：S_outcome 占 S_core 的 0.50，「验收断言通过率」是它的唯一数据源。
 * 如果 `doc_count` 由 Agent 自己上报，那么改一行 `report({"doc_count": 999})`
 * 就能把分数刷满——录制回放的全部确定性努力会被一个可伪造的数字抵消。
 * 因此每个事实都必须是「运行过程中被观测到的行为」的确定性函数。
 *
 * 推论：`no_unauthorized_mutation` 这类安全断言**不在本词汇表内**。
 * 安全是 ScoreInput.security 里的门控（Gate_security），由独立检查产出，
 * 不参与 S_outcome 的比例计算——详见 packages/scorer/src/types.ts。
 */
import type { ExprType } from "./expr.js";
import type { AgentTrace, EfficiencyMetrics } from "./types.js";

/**
 * 可从轨迹推导的事实集合。
 * 命名用蛇形，与契约模板里的表达式写法一致。
 *
 * 刻意写成 **type 别名而非 interface**：TS 只给对象字面量类型别名隐式索引签名，
 * interface 没有。用 interface 会导致 TraceFacts 无法传给 `evalExpr(src, facts: Facts)`
 * ——而 Facts 就是 `Record<string, ExprValue>`。
 */
export type TraceFacts = {
  // ---- 计数 ----
  /** 工具调用总次数。 */
  step_count: number;
  /** 检测到的循环数（相同操作在非相邻位置重复出现）。 */
  loop_count: number;
  /** 检索调用次数。 */
  retrieval_count: number;
  /** 全部检索结果中去重后的文档 id 数（Deduplicated doc ids Observed）。 */
  doc_count: number;
  /** HTTP 请求-响应对数（录制代理捕获）。 */
  http_count: number;

  // ---- 比率（0–1，越大越好，step_redundancy 除外） ----
  /** 工具选择准确率：未调用契约声明之外工具的比例。 */
  tool_choice_accuracy: number;
  /** 参数正确率：满足声明必填字段的比例。 */
  param_correctness: number;
  /** 工具调用成功率。 */
  success_rate: number;
  /** 步数冗余率（越低越好）。 */
  step_redundancy: number;
  /**
   * 检索命中率。**无检索时为 0**，并配 `has_retrieval=false`。
   *
   * 注意与 `sSemantic` 的差异：sSemantic 把「无检索」视为不适用而给满分，
   * 因为那是评分维度；而验收断言是**要求**——契约写 `retrieval_hit_rate >= 0.9`
   * 就意味着这个任务必须检索，没检索就是没做到。需要区分两种情况时，
   * 契约里写 `has_retrieval && retrieval_hit_rate >= 0.9`。
   */
  retrieval_hit_rate: number;

  // ---- 布尔 ----
  /** 是否有检索调用。 */
  has_retrieval: boolean;
  /** 是否产出了最终答案。 */
  has_final_answer: boolean;
  /** 最终答案是否带引用。 */
  answer_has_citation: boolean;

  // ---- 集合（用 ⊆ / ⊇ / ∈ / ∉ / == 比较） ----
  /** 最终答案引用的文档 id。 */
  cited_doc_ids: string[];
  /** 全部检索返回过的文档 id（去重）。 */
  retrieval_doc_ids: string[];

  // ---- 规模 ----
  /** 总延迟（毫秒）：LLM span + 工具调用。 */
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
}

/**
 * 词汇表全部标识符。
 * `satisfies` 保证名字拼错或字段被删时**编译即失败**——避免词汇表与接口悄悄漂移。
 */
export const FACT_NAMES = [
  "step_count",
  "loop_count",
  "retrieval_count",
  "doc_count",
  "http_count",
  "tool_choice_accuracy",
  "param_correctness",
  "success_rate",
  "step_redundancy",
  "retrieval_hit_rate",
  "has_retrieval",
  "has_final_answer",
  "answer_has_citation",
  "cited_doc_ids",
  "retrieval_doc_ids",
  "latency_ms",
  "prompt_tokens",
  "completion_tokens",
] as const satisfies readonly (keyof TraceFacts)[];

/** 供报告与测试枚举全部事实名。 */
export const FACT_NAME_SET: ReadonlySet<string> = new Set<string>(FACT_NAMES);

/**
 * 事实的静态类型表。**键集合即 assert 表达式的标识符白名单**，
 * 与 `checkExpr` 的第二个参数同型——白名单与类型表是同一份数据，不会漂移。
 *
 * `satisfies Record<keyof TraceFacts, ExprType>` 的三重保证：
 * 字段被删 → 少键报错；新增事实未登记类型 → 少键报错；类型写错 → 报错。
 * 于是「词汇表」与「类型表」在编译期强制同步。
 */
export const FACT_TYPES = {
  step_count: "number",
  loop_count: "number",
  retrieval_count: "number",
  doc_count: "number",
  http_count: "number",

  tool_choice_accuracy: "number",
  param_correctness: "number",
  success_rate: "number",
  step_redundancy: "number",
  retrieval_hit_rate: "number",

  has_retrieval: "boolean",
  has_final_answer: "boolean",
  answer_has_citation: "boolean",

  cited_doc_ids: "string_array",
  retrieval_doc_ids: "string_array",

  latency_ms: "number",
  prompt_tokens: "number",
  completion_tokens: "number",
} as const satisfies Record<keyof TraceFacts, ExprType>;

/** 去重并保持稳定顺序（便于测试断言与报告展示）。 */
function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * 从轨迹与效率指标推导事实。
 *
 * 纯函数：同样的 trace 必得同样的 facts——这是「回放两次评分一致」的前提。
 */
export function factsOf(trace: AgentTrace, m: EfficiencyMetrics): TraceFacts {
  const retrievalDocIds = dedupe(trace.retrievals.flatMap((r) => r.returnedDocIds));
  const citedDocIds = dedupe(trace.finalAnswer?.citedDocIds ?? []);
  const hasRetrieval = trace.retrievals.length > 0;

  return {
    step_count: m.steps,
    loop_count: m.loopCount,
    retrieval_count: trace.retrievals.length,
    // 文档数取「检索结果里见过的不同 id」，而不是任何自报的语料规模。
    doc_count: retrievalDocIds.length,
    http_count: trace.http.length,

    tool_choice_accuracy: m.toolChoiceAccuracy,
    param_correctness: m.paramCorrectness,
    success_rate: m.successRate,
    step_redundancy: m.stepRedundancy,
    retrieval_hit_rate: m.retrievalHitRate ?? 0,

    has_retrieval: hasRetrieval,
    has_final_answer: trace.finalAnswer !== undefined,
    answer_has_citation: citedDocIds.length > 0,

    cited_doc_ids: citedDocIds,
    retrieval_doc_ids: retrievalDocIds,

    latency_ms: m.totalLatencyMs,
    prompt_tokens: m.totalPromptTokens,
    completion_tokens: m.totalCompletionTokens,
  };
}
