/** 预算状态（PRD §7「三级预算守卫」）。 */
export type BudgetState = "normal" | "warned" | "degraded" | "halted";

export interface BudgetThresholds {
  warn: number; // 默认 0.70：警告
  degrade: number; // 默认 0.90：降级
  halt: number; // 默认 1.00：硬中断
}

export interface BudgetStatus {
  state: BudgetState;
  used: number;
  limit: number;
  usedRatio: number; // 0..∞
  remaining: number;
  canSpend: boolean; // halted 时为 false
}
