/**
 * 四道防作弊类型（P2 任务 3 / 开发文档 §7.4）。
 */
import type { AgentTrace } from "@cegueira/trace";

/** 数据流断言（答案的某个字段必须来自检索或工具返回）。 */
export interface DataFlowAssertion {
  source: "retrieval" | "tool";
  /** 例如 "answer.cited_doc_ids"、"answer.text"。 */
  field: string;
}

/** 评测集条目（对应开发文档 §7.4 的 evalset 结构）。 */
export interface EvalCase {
  id: string;
  prompt: string;
  expectedOutcome: string;
  dataFlowAssertions: DataFlowAssertion[];
  /** 公开集（用户可见可改）或留出集（仅评分时用，用户不可见）。 */
  split: "public" | "holdout";
  /** 同义改写（P2 用确定性模板；P4 校准后接 LLM）。 */
  rewrites: string[];
  /** 语料扰动注入的噪声文档 id（明显无关/错误，用于检测污染）。 */
  noiseDocIds?: string[];
}

/** 防作弊报告。 */
export interface AntiCheatReport {
  /** 留出集是否完整运行（未跳过）。 */
  holdoutIntact: boolean;
  holdoutMissing: string[];
  /** 答案是否疑似复制题目（硬编码嫌疑）。 */
  rewriteSuspicious: boolean;
  rewriteReasons: string[];
  /** 数据流断言违规项。 */
  dataFlowViolations: string[];
  /** 是否未被噪声文档污染。 */
  perturbationResistant: boolean;
  perturbationLeaks: string[];
  /** 综合判定：任一防线触发即视为作弊。 */
  cheated: boolean;
  reasons: string[];
}
