/** 辅助阶梯 L0–L4（PRD §6.4）：在用户想放弃时给恰好够用的帮助。 */
export type LadderLevel = 0 | 1 | 2 | 3 | 4;

export const DEFAULT_LEVEL: LadderLevel = 2;

export const LEVEL_DESC: Record<LadderLevel, string> = {
  0: "只报错，不说原因方向",
  1: "指向范围（指位置，不给答案）",
  2: "提问引导（反问）",
  3: "给方案思路，不给代码",
  4: "给可运行代码",
};

export interface LadderState {
  level: LadderLevel;
  rejections: number;
  l3Requests: number;
  l4Requests: number;
  l4Explained: boolean; // L4 是否已用自己的话解释
}

export function initialState(): LadderState {
  return {
    level: DEFAULT_LEVEL,
    rejections: 0,
    l3Requests: 0,
    l4Requests: 0,
    l4Explained: false,
  };
}

/** 用户卡住（当前引导不足以解决）→ 解锁下一级。 */
export function onStuck(s: LadderState): LadderState {
  const next = Math.min(s.level + 1, 4) as LadderLevel;
  return { ...s, level: next, rejections: s.rejections + 1 };
}

/** 主动升级到 L3+（需用户显式要求）。 */
export function requestUpgrade(s: LadderState, target: LadderLevel): LadderState {
  if (target < 3) throw new Error("L0–L2 无需主动升级");
  const next: LadderState = { ...s, level: target };
  if (target === 3) next.l3Requests += 1;
  if (target === 4) next.l4Requests += 1;
  return next;
}

/** L4 给代码后，用户须用自己的话解释；未解释则技能分不升级。 */
export function explainL4(s: LadderState): LadderState {
  return { ...s, l4Explained: true };
}

/** 阶梯使用是否为「掌握度被高估」的负向信号（频繁请求 L3/L4）。 */
export function isOverReliant(s: LadderState, threshold = 3): boolean {
  return s.l3Requests + s.l4Requests > threshold;
}
