/**
 * 结构化轨迹与效率指标类型（开发文档 §8.2 / P2 任务 2）。
 *
 * 录制回放的三类产物（http.yaml / trace.json / tool_io.log）统一抽象为
 * AgentTrace，供轨迹效率指标计算、S_process 落地与四道防作弊消费。
 */

/** 工具调用（tool_io.log 条目）。 */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  /** 调用是否成功（无异常返回）。 */
  ok: boolean;
  latencyMs: number;
}

/** LLM span（trace.json 的 GenAI span）。 */
export interface LlmSpan {
  id: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

/** 检索调用（trace.json 的 retrieval span）。 */
export interface RetrievalCall {
  id: string;
  query: string;
  /** 命中的文档 id 列表。 */
  returnedDocIds: string[];
}

/** HTTP 请求-响应对（http.yaml 条目，按请求指纹存储）。 */
export interface HttpExchange {
  fingerprint: string;
  request: { method: string; path: string; body: string };
  response: { status: number; body: string };
}

/** 最终答案（供数据流断言 / 防作弊用）。 */
export interface FinalAnswer {
  text: string;
  citedDocIds: string[];
}

/** 结构化轨迹。 */
export interface AgentTrace {
  http: HttpExchange[];
  tools: ToolCall[];
  llmSpans: LlmSpan[];
  retrievals: RetrievalCall[];
  finalAnswer?: FinalAnswer;
}

/** 工具参数 schema（契约声明中可判定为「必填字段」的最小部分）。 */
export interface ToolSchema {
  required: string[];
}

/**
 * 轨迹效率指标（P2 任务 2）。
 * 除 steps/token/latency 外均为 0–1 的比例值，全部由确定性代码判定。
 */
export interface EfficiencyMetrics {
  /** 工具调用总次数。 */
  steps: number;
  /** 工具选择准确率（未调用声明外工具的比例）。 */
  toolChoiceAccuracy: number;
  /** 参数正确率（满足声明必填字段的比例；未声明 schema 的调用不计入分母）。 */
  paramCorrectness: number;
  /** 工具调用成功率（ok 的比例）。 */
  successRate: number;
  /** 步数冗余率（重复无意义调用占比，越低越好）。 */
  stepRedundancy: number;
  /** 检测到的循环数（相同操作在非相邻位置重复出现）。 */
  loopCount: number;
  /** 检索命中率（返回非空的比例）；无检索调用时为 null。 */
  retrievalHitRate: number | null;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalLatencyMs: number;
}
