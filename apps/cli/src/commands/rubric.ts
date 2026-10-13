/**
 * ceg rubric：用 LLM 评审 rubric 维度（PRD §4.5 S_rubric + §7 隐私）。
 *
 * ## 一次接线，连通三个此前无消费方的模块
 *
 * - `@cegueira/scorer` 的 `evaluateRubricCrossFamily`（跨家族、逐维度中位数）
 * - `@cegueira/llm` 的 provider 抽象（本地 Ollama 默认，OpenAI/Anthropic 可配）
 * - `@cegueira/privacy` 的流水线（脱敏 → AST 裁剪 → 外发预览）
 *
 * ## 外发预览是**强制**步骤
 *
 * PRD §7 明确「外发预览为强制步骤，不可跳过」。因此本命令默认**只打印预览、
 * 不外发**；必须显式 `--yes` 才真正调用 LLM。这样把「发给谁、发什么内容」
 * 摆到用户面前，而不是悄悄发出。
 *
 * ## 为什么 provider 可注入
 *
 * 单测不能真连 LLM。`rubricCommand` 接受一个 provider 工厂，测试注入假 provider
 * 即可验证「预览拦截 → 确认 → 评审 → 报告」全链路，不触网。
 */
import { readFileSync } from "node:fs";
import { createBudget } from "@cegueira/budget";
import {
  createAnthropicProvider,
  createOllamaProvider,
  createOpenAIProvider,
  type LlmConfig,
  type LlmProvider,
} from "@cegueira/llm";
import { processPrivacy, type OutboundPurpose } from "@cegueira/privacy";
import { evaluateRubricCrossFamily, type RubricPrompt } from "@cegueira/scorer";

export interface RubricOptions {
  rubricPath: string;
  artifactPath: string;
  /** provider 家族列表（跨家族评审）；缺省 ["ollama"]。 */
  llms?: string[];
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  purpose?: OutboundPurpose;
  /** 是否已确认外发（--yes）。未确认则只出预览。 */
  confirmed?: boolean;
  /** 预估 token 预算上限（--budget）。缺省则不启用三级守卫。 */
  budgetTokens?: number;
}

/** 每次评审调用预留的补全 token 粗估（评分理由 + 1–5 评级，宽松取值）。 */
export const COMPLETION_TOKEN_EST = 200;

export type ProviderFactory = (ids: string[], config: LlmConfig) => LlmProvider[];

/** 默认 provider 工厂：按 id 构造。 */
export const defaultProviderFactory: ProviderFactory = (ids, config) =>
  ids.map((id) => {
    switch (id) {
      case "ollama":
        return createOllamaProvider(config);
      case "openai":
        return createOpenAIProvider(config);
      case "anthropic":
        return createAnthropicProvider(config);
      default:
        throw new Error(`未知 LLM provider：${id}（可选 ollama / openai / anthropic）`);
    }
  });

/**
 * 解析 rubric 文件：接受 `[{id,prompt}]` 或 `{rubrics:[{id,prompt}]}` 两种形状。
 * 与 contract.json 的 `rubrics` 字段同形，便于直接喂 `ceg init` 的产物。
 */
export function parseRubricFile(text: string): RubricPrompt[] {
  const raw = JSON.parse(text) as unknown;
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { rubrics?: unknown }).rubrics)
      ? ((raw as { rubrics: unknown[] }).rubrics)
      : null;
  if (arr === null) {
    throw new Error("rubric 文件应为数组或含 rubrics 数组的对象");
  }
  const items: RubricPrompt[] = arr.map((entry, i) => {
    const obj = entry as { id?: unknown; prompt?: unknown };
    if (typeof obj.id !== "string" || typeof obj.prompt !== "string") {
      throw new Error(`rubric[${i}] 需含字符串 id 与 prompt`);
    }
    return { id: obj.id, prompt: obj.prompt };
  });
  if (items.length === 0) throw new Error("rubric 不能为空");
  return items;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 执行评审，返回报告文本。 */
export async function rubricCommand(
  opts: RubricOptions,
  factory: ProviderFactory = defaultProviderFactory,
): Promise<string> {
  const items = parseRubricFile(readFileSync(opts.rubricPath, "utf8"));
  const artifact = readFileSync(opts.artifactPath, "utf8");
  const purpose: OutboundPurpose = opts.purpose ?? "review";
  const privacy = processPrivacy(artifact, purpose);

  const previewLines = [
    `外发预览（强制步骤）：`,
    `  路由建议供应商：${privacy.preview.supplier}（purpose=${purpose}）`,
    `  外发内容：${privacy.preview.charCount} 字符，约 ${privacy.preview.tokenEstimate} tokens`,
    `  脱敏命中：${privacy.redacted.hitCount} 处 [${privacy.redacted.hits.join(", ") || "无"}]`,
    `  ${privacy.preview.summary}`,
  ];

  if (!opts.confirmed) {
    return [...previewLines, "", "尚未外发。确认无误后加 --yes 执行评审。"].join("\n");
  }

  let ids = opts.llms && opts.llms.length > 0 ? opts.llms : ["ollama"];

  // 三级预算守卫（PRD §7）：70% 警告 / 90% 降级 / 100% 硬中断。
  // 用预估 token 做前置检查：calls ×（提示 token 估 + 补全 token 估）。
  const budgetLines: string[] = [];
  if (opts.budgetTokens !== undefined) {
    const calls = items.length * ids.length;
    const estimated = calls * (privacy.preview.tokenEstimate + COMPLETION_TOKEN_EST);
    const guard = createBudget(opts.budgetTokens);
    const st = guard.consume(estimated);
    budgetLines.push(
      `预算：预估 ${estimated} / 上限 ${opts.budgetTokens} tokens（${Math.round(st.usedRatio * 100)}%，状态 ${st.state}）`,
    );
    if (st.state === "halted") {
      budgetLines.push("预算已耗尽（≥100%），硬中断，未发起任何调用。请提高 --budget 或缩小范围。");
      return [...budgetLines, "", ...previewLines].join("\n");
    }
    if (st.state === "degraded") {
      budgetLines.push(`预算 ≥90%，降级为单家族评审：仅 ${ids[0]}。`);
      ids = [ids[0]];
    } else if (st.state === "warned") {
      budgetLines.push("预算 ≥70%，警告：继续将接近上限。");
    }
  }

  const providers = factory(ids, {
    model: opts.model,
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
  });
  const scores = await evaluateRubricCrossFamily(providers, items, privacy.pruned);

  const lines = [
    ...budgetLines,
    `S_rubric 评审（跨家族 ${ids.join(" + ")}，逐维度取中位数）：`,
    ...items.map(
      (it, i) =>
        `  ${scores[i].toFixed(3)}  [${it.id}] ${it.prompt}  （${items.length} 维度之一）`,
    ),
    `  S_rubric 维度均值：${mean(scores).toFixed(3)}`,
    "",
    ...previewLines,
  ];
  return lines.join("\n");
}
