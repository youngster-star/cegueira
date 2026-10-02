/**
 * 契约五件套类型定义（PRD §6.1 / 开发文档 §7.1）。
 * 五件套：project.md（人读）、contract.json（机读）、rubric.yaml（评分引擎）、
 *         checks/（检测配方）、evalset/（黄金测试集）。
 */

/** 契约 schema 版本。 */
export const CONTRACT_SCHEMA = "1.0";

/** 验收条件类型：可构造为可执行断言。 */
export type AcceptanceType = "assert" | "tool_call_in" | "no_loop" | "latency_lt";

/**
 * 一条可执行验收断言。
 * - assert:      布尔表达式（expr）
 * - tool_call_in: 工具白名单（tools）
 * - no_loop:     无循环（无需额外字段）
 * - latency_lt:  延迟上限（maxMs，毫秒）
 */
export interface Acceptance {
  type: AcceptanceType;
  expr?: string;
  tools?: string[];
  maxMs?: number;
  description?: string;
}

/** 任务：契约 DAG 的叶子单元，含验收条件、依赖、权重。 */
export interface Task {
  id: string;
  name: string;
  depends_on: string[];
  weight: number;
  acceptance: Acceptance[];
}

/** 阶段：若干任务组成。 */
export interface Stage {
  id: string;
  name: string;
  tasks: Task[];
}

/** contract.json：机读契约。 */
export interface Contract {
  schema: string;
  project_id: string;
  title: string;
  stages: Stage[];
}

/** 安全三断言（PRD §4.6）。 */
export const SECURITY_ASSERTIONS = [
  "no_unauthorized_mutation",
  "tool_call_whitelist",
  "no_prompt_leak",
] as const;

export type SecurityAssertion = (typeof SECURITY_ASSERTIONS)[number];

/** rubric.yaml：评分细则 + 门控阈值。 */
export interface Rubric {
  schema: string;
  mandatory_tests: string[];
  gates: {
    security: SecurityAssertion[];
    outcome_min: number;
  };
  rubrics: RubricItem[];
}

/** 供 S_rubric 的 LLM 评审条目。 */
export interface RubricItem {
  id: string;
  prompt: string;
}

/** evalset：黄金测试集单条。 */
export interface EvalTest {
  id: string;
  prompt: string;
  expected_outcome: string;
  data_flow_assertions: { source: string; field: string }[];
  splits: "public" | "holdout";
  rewrites: string[];
}

export interface EvalSet {
  tests: EvalTest[];
}

/** 可执行检查配方：L1 静态扫描 / L2 轨迹断言。 */
export interface Check {
  id: string;
  layer: "L1" | "L2";
  rule: string;
}

/** project.md（人读）。 */
export interface ProjectMd {
  title: string;
  coreFunction: string;
  coreTech: string;
  envPrereq: string;
  coreDifficulty: string;
}

/** 契约五件套聚合。 */
export interface ContractBundle {
  projectMd: ProjectMd;
  contract: Contract;
  rubric: Rubric;
  checks: Check[];
  evalset: EvalSet;
}
