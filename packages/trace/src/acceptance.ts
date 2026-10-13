/**
 * 验收断言求值（A1）。
 *
 * 这是 S_outcome（S_core 权重 0.50）的唯一数据源：把契约里每个任务的
 * acceptance 清单，对着一次真实轨迹逐条判定通过与否，产出通过率采样。
 *
 * 设计要点：
 *
 * 1. **「不可求值」与「未通过」是两件事，必须分开报告。**
 *    断言写错了（未识别标识符 / 语法错误 / 类型不符）属于**契约缺陷**，
 *    不属于「Agent 没做到」。把两者都记成 false 会让契约缺陷伪装成能力不足，
 *    是错误归因。因此不可求值的条目**不计入分母**，并在结果里单独列出原因。
 *
 * 2. **一条都不可求值时抛错，不返回 0。**
 *    返回 0 等于「因为契约写错了，所以给用户 0 分」——静默的错误归因。
 *    与 packages/scorer 的 sOutcome/sRubric 越界即抛错保持同一风格。
 *
 * 3. 本模块不 import @cegueira/contract，改用结构性等价的 AcceptanceLike。
 *    原因见 packages/trace/package.json 的依赖说明：declaration 方向是
 *    contract → trace（校验器需要词汇表），反向 import 会成环。
 *    contract 侧有一条编译期断言保证两者不漂移。
 */
import { evalExpr } from "./expr.js";
import type { TraceFacts } from "./facts.js";
import type { AgentTrace, EfficiencyMetrics } from "./types.js";

/**
 * 与 @cegueira/contract 的 `Acceptance` 结构性等价。
 * 字段增删必须两边同步——contract/src/types.ts 有编译期断言兜底。
 */
export interface AcceptanceLike {
  type: "assert" | "tool_call_in" | "no_loop" | "latency_lt";
  expr?: string;
  tools?: string[];
  maxMs?: number;
  description?: string;
}

/** 单条断言的判定结果。 */
export interface AcceptanceOutcome {
  /** 在 acceptance 清单中的下标，便于回指契约原文。 */
  index: number;
  type: string;
  /** 契约里的人类可读描述，可能没有。 */
  description?: string;
  /** 断言原文（表达式 / 工具白名单 / 毫秒数），报告里直接展示。 */
  spec: string;
  passed: boolean;
  /**
   * 不可求值的原因。
   * `passed === false` 且本字段存在 ⇒ 是**契约缺陷**，不是 Agent 的行为问题。
   */
  unevaluable?: string;
}

/** 一个任务的验收结果。 */
export interface TaskAcceptanceResult {
  /** 通过率 = passed / evaluable，取值 0–1。至少要有一条可求值断言（否则抛错）。 */
  rate: number;
  passed: number;
  /** 可求值的断言条数，即 rate 的分母。 */
  evaluable: number;
  /** 断言总条数。`total > evaluable` 说明契约里有写坏的断言。 */
  total: number;
  outcomes: AcceptanceOutcome[];
}

/** 断言原文的可读形式，用于报告。 */
function specOf(a: AcceptanceLike): string {
  switch (a.type) {
    case "assert":
      return a.expr ?? "";
    case "tool_call_in":
      return (a.tools ?? []).join(", ");
    case "no_loop":
      return "无循环";
    case "latency_lt":
      return `< ${a.maxMs ?? "?"} ms`;
    default:
      return "";
  }
}

/**
 * 逐条判定一个任务的 acceptance。
 *
 * @throws 当一条都不可求值时——宁可中断，也不返回一个会误导用户的 0 分。
 */
export function evaluateTaskAcceptance(
  acceptance: readonly AcceptanceLike[],
  trace: AgentTrace,
  facts: TraceFacts,
  metrics: EfficiencyMetrics,
): TaskAcceptanceResult {
  const outcomes: AcceptanceOutcome[] = acceptance.map((a, index) => {
    const base = { index, type: a.type, description: a.description, spec: specOf(a) };

    switch (a.type) {
      case "assert": {
        if (a.expr === undefined || a.expr.trim().length === 0) {
          return { ...base, passed: false, unevaluable: "assert 缺少布尔表达式 expr" };
        }
        const r = evalExpr(a.expr, facts);
        if (!r.ok) return { ...base, passed: false, unevaluable: r.reason };
        return { ...base, passed: r.value as boolean };
      }

      case "tool_call_in": {
        if (a.tools === undefined || a.tools.length === 0) {
          return { ...base, passed: false, unevaluable: "tool_call_in 缺少工具白名单" };
        }
        const allowed = new Set(a.tools);
        // 全部工具调用都落在白名单内才算通过（一次越界即不通过）。
        return { ...base, passed: trace.tools.every((t) => allowed.has(t.name)) };
      }

      case "no_loop":
        return { ...base, passed: metrics.loopCount === 0 };

      case "latency_lt": {
        if (typeof a.maxMs !== "number" || !Number.isFinite(a.maxMs) || a.maxMs <= 0) {
          return { ...base, passed: false, unevaluable: "latency_lt 缺少正数 maxMs" };
        }
        return { ...base, passed: metrics.totalLatencyMs < a.maxMs };
      }

      default:
        // TS 联合类型挡不住来自 JSON 的脏数据，这里必须兜底。
        return { ...base, passed: false, unevaluable: `未知 acceptance 类型 ${String(a.type)}` };
    }
  });

  const evaluable = outcomes.filter((o) => o.unevaluable === undefined).length;
  const passed = outcomes.filter((o) => o.passed).length;

  if (evaluable === 0) {
    const detail =
      outcomes.length === 0
        ? "该任务没有任何验收断言"
        : outcomes.map((o) => `#${o.index} ${o.type}: ${o.unevaluable}`).join("; ");
    throw new Error(
      `没有一条可求值的验收断言，拒绝评分（否则会把契约缺陷算成 Agent 的 0 分）：${detail}`,
    );
  }

  return { rate: passed / evaluable, passed, evaluable, total: outcomes.length, outcomes };
}
