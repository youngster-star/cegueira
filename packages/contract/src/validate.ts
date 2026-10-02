/**
 * 契约校验器：校验 contract.json 合法性、acceptance 可构造为可执行断言。
 * PRD §6.3「可校验性自检」的判定核心。
 */
import {
  CONTRACT_SCHEMA,
  SECURITY_ASSERTIONS,
  type Acceptance,
  type Contract,
  type Rubric,
} from "./types.js";

/** 校验结果：ok 或携带失败原因。 */
export type CheckResult = { ok: true } | { ok: false; reason: string };

/** weight 归一化容差。 */
const WEIGHT_TOLERANCE = 1e-6;

/**
 * 单条 acceptance 是否可构造为可执行断言（PRD §6.3 自检的最小判定单元）。
 */
export function isExecutableAcceptance(a: Acceptance): CheckResult {
  switch (a.type) {
    case "assert":
      return a.expr !== undefined && a.expr.trim().length > 0
        ? { ok: true }
        : { ok: false, reason: `assert 缺少布尔表达式 expr` };
    case "tool_call_in":
      return a.tools !== undefined &&
        a.tools.length > 0 &&
        a.tools.every((t) => typeof t === "string" && t.trim().length > 0)
        ? { ok: true }
        : { ok: false, reason: `tool_call_in 缺少有效的工具白名单 tools（需非空字符串列表）` };
    case "no_loop":
      return { ok: true };
    case "latency_lt":
      return typeof a.maxMs === "number" && Number.isFinite(a.maxMs) && a.maxMs > 0
        ? { ok: true }
        : { ok: false, reason: `latency_lt 缺少正数 maxMs` };
    default:
      return { ok: false, reason: `未知 acceptance 类型` };
  }
}

/**
 * 校验整个 contract.json 结构：
 * - schema 版本匹配
 * - 每阶段 tasks 非空
 * - 每任务 weight 归一化到 1.0（每 stage 内 tasks weight 之和）
 * - 每条 acceptance 可构造断言
 */
export function validateContract(c: Contract): CheckResult {
  if (c.schema !== CONTRACT_SCHEMA) {
    return { ok: false, reason: `schema 版本应为 ${CONTRACT_SCHEMA}，实际 ${c.schema}` };
  }
  if (!c.project_id || !c.title) {
    return { ok: false, reason: "缺少 project_id 或 title" };
  }
  if (!Array.isArray(c.stages) || c.stages.length === 0) {
    return { ok: false, reason: "stages 不能为空" };
  }

  for (const stage of c.stages) {
    if (!Array.isArray(stage.tasks) || stage.tasks.length === 0) {
      return { ok: false, reason: `阶段 ${stage.id} 的 tasks 不能为空` };
    }
    const weightSum = stage.tasks.reduce((s, t) => s + t.weight, 0);
    if (Math.abs(weightSum - 1.0) > WEIGHT_TOLERANCE) {
      return {
        ok: false,
        reason: `阶段 ${stage.id} 的 tasks weight 之和应为 1.0，实际 ${weightSum.toFixed(4)}`,
      };
    }
    for (const task of stage.tasks) {
      if (!Array.isArray(task.acceptance) || task.acceptance.length === 0) {
        return { ok: false, reason: `任务 ${task.id} 缺少 acceptance` };
      }
      for (const a of task.acceptance) {
        const r = isExecutableAcceptance(a);
        if (!r.ok) {
          return { ok: false, reason: `任务 ${task.id}: ${r.reason}` };
        }
      }
    }
  }
  return { ok: true };
}

/**
 * 校验 rubric.yaml：安全三断言齐全、outcome_min 在 (0,1]。
 */
export function validateRubric(r: Rubric): CheckResult {
  if (r.schema !== CONTRACT_SCHEMA) {
    return { ok: false, reason: `rubric schema 版本应为 ${CONTRACT_SCHEMA}` };
  }
  for (const s of SECURITY_ASSERTIONS) {
    if (!r.gates.security.includes(s)) {
      return { ok: false, reason: `安全断言缺失: ${s}` };
    }
  }
  if (!(r.gates.outcome_min > 0 && r.gates.outcome_min <= 1)) {
    return { ok: false, reason: `outcome_min 应在 (0,1]，实际 ${r.gates.outcome_min}` };
  }
  if (!Array.isArray(r.mandatory_tests) || r.mandatory_tests.length === 0) {
    return { ok: false, reason: "mandatory_tests 不能为空" };
  }
  return { ok: true };
}
