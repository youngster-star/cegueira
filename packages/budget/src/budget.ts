import type { BudgetState, BudgetStatus, BudgetThresholds } from "./types.js";

const DEFAULT_THRESHOLDS: BudgetThresholds = {
  warn: 0.7,
  degrade: 0.9,
  halt: 1.0,
};

export interface BudgetGuard {
  /** 消耗 amount 后返回最新状态。halted 后消耗仍累计（用于记录超额），但 canSpend=false。 */
  consume(amount: number): BudgetStatus;
  /** 当前状态快照，不改变消耗。 */
  status(): BudgetStatus;
}

/**
 * 三级预算守卫：70% 警告 / 90% 降级 / 100% 硬中断。
 * 硬中断后拒绝继续调用（canSpend=false），由调用方停止发起请求。
 */
export function createBudget(
  limit: number,
  thresholds: Partial<BudgetThresholds> = {},
): BudgetGuard {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new RangeError("预算上限必须为正有限数");
  }
  const t: BudgetThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  if (!(t.warn >= 0 && t.warn < t.degrade && t.degrade <= t.halt)) {
    throw new RangeError("阈值须满足 0 <= warn < degrade <= halt");
  }
  let used = 0;

  function stateOf(ratio: number): BudgetState {
    if (ratio >= t.halt) return "halted";
    if (ratio >= t.degrade) return "degraded";
    if (ratio >= t.warn) return "warned";
    return "normal";
  }

  function buildStatus(): BudgetStatus {
    const ratio = used / limit;
    const state = stateOf(ratio);
    return {
      state,
      used,
      limit,
      usedRatio: ratio,
      remaining: Math.max(0, limit - used),
      canSpend: state !== "halted",
    };
  }

  return {
    consume(amount) {
      if (!Number.isFinite(amount) || amount < 0) {
        throw new RangeError("消耗量须为非负有限数");
      }
      used += amount;
      return buildStatus();
    },
    status: buildStatus,
  };
}
