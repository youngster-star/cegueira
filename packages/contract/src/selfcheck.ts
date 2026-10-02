/**
 * 可校验性自检（PRD §6.3）：验收条件能否构造可执行断言？
 * 不合格 → 重新生成（≤3 次）→ 仍失败则降级并标注。
 */
import { generateBundle, type GenerationInput } from "./generate.js";
import type { ContractBundle } from "./types.js";
import { validateContract, validateRubric } from "./validate.js";

/** 自检结果：通过或失败（含原因）。 */
export type SelfCheckResult = { ok: true } | { ok: false; reason: string };

/**
 * 对五件套做整体自检：contract 与 rubric 均合法。
 * 校验逻辑（acceptance 可构造性）集中在 validateContract 内。
 */
export function selfCheck(bundle: ContractBundle): SelfCheckResult {
  const c = validateContract(bundle.contract);
  if (!c.ok) return { ok: false, reason: `contract: ${c.reason}` };
  const r = validateRubric(bundle.rubric);
  if (!r.ok) return { ok: false, reason: `rubric: ${r.reason}` };
  return { ok: true };
}

/** 生成结果：五件套 + 尝试次数 + 是否降级。 */
export interface GeneratedBundle {
  bundle: ContractBundle;
  attempts: number;
  degraded: boolean;
}

/**
 * 生成 + 自检 + 重生成（≤ maxAttempts 次）。
 * 仍失败则降级：返回最后一次生成结果并标注 degraded（PRD §6.3「降级标注」）。
 *
 * 说明：P1 模板生成器是确定性的，首次即通过自检；重生成机制为
 * 后续接入 LLM 生成器（可能产出非法契约）预留。
 */
export function generateWithSelfCheck(
  input: GenerationInput,
  maxAttempts = 3,
  gen = generateBundle,
): GeneratedBundle {
  for (let i = 1; i <= maxAttempts; i++) {
    const bundle = gen(input);
    const check = selfCheck(bundle);
    if (check.ok) {
      return { bundle, attempts: i, degraded: false };
    }
  }
  // 全部失败：降级返回最后一次结果
  const bundle = gen(input);
  return { bundle, attempts: maxAttempts, degraded: true };
}
