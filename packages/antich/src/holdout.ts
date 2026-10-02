/**
 * 防线 1：留出集完整性。
 *
 * 留出集（holdout）的题目用户不可见，评分时必须真实运行。
 * 若用户/流程跳过留出集，则视为作弊（针对性绕过评测）。
 */

export interface HoldoutResult {
  intact: boolean;
  missing: string[];
}

export function checkHoldout(runCaseIds: string[], holdoutIds: string[]): HoldoutResult {
  const missing = holdoutIds.filter((id) => !runCaseIds.includes(id));
  return { intact: missing.length === 0, missing };
}
