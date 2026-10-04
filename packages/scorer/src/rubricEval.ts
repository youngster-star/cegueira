/**
 * S_rubric 落地：用 LLM 评审 rubric 条目（PRD §4.5）。
 *
 * 这是「LLM 只说话、不打分」原则的唯一例外（S_rubric 权重仅 0.10，且跨家族
 * 取中位数兜底）。每个 rubric item 独立评审，返回 0–1 分；单条失败降级 0.5，
 * 不阻塞整体评分。
 */
import type { LlmProvider } from "@cegueira/llm";

/** 供 LLM 评审的条目（结构化类型，避免 scorer 反向依赖 contract）。 */
export interface RubricPrompt {
  id: string;
  prompt: string;
}

const SYSTEM_PROMPT =
  "你是 Cegueira 评分引擎的评审员。根据给定评审维度对提交物打分（0.0 到 1.0，1.0 为满分）。" +
  '只输出一个 JSON 对象，格式：{"score": <0到1的浮点数>, "reason": "<一句话理由>"}。';

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** 归一化分数：明显百分制（≥10 且 ≤100）除以 100，其余裁剪到 [0,1]。 */
function normalizeScore(v: number): number {
  if (v >= 10 && v <= 100) return v / 100;
  return clamp01(v);
}

/**
 * 从 LLM 输出解析 0–1 分数（宽容解析：容忍 markdown 代码块、前后缀文本、百分制）。
 * 解析失败返回 null。
 */
export function parseRubricScore(raw: string): number | null {
  let s = raw.trim();
  // 去掉 markdown 代码块包裹
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

  // 优先：提取首个 {...} 对象里的 score 字段
  const objMatch = s.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const obj = JSON.parse(objMatch[0]) as Record<string, unknown>;
      const v = (obj.score ?? obj.Score) as unknown;
      if (typeof v === "number" && Number.isFinite(v)) return normalizeScore(v);
    } catch {
      /* fallthrough 到正则兜底 */
    }
  }

  // 兜底 1：`"score": 0.8` 或 `score = 0.8`
  const kv = s.match(/["']?score["']?\s*[:=]\s*([0-9]*\.?[0-9]+)/i);
  if (kv) {
    const v = Number(kv[1]);
    if (Number.isFinite(v)) return normalizeScore(v);
  }

  // 兜底 2：首个裸数字
  const num = s.match(/([0-9]*\.?[0-9]+)/);
  if (num) {
    const v = Number(num[1]);
    return normalizeScore(v);
  }
  return null;
}

/** 单个 rubric item 评审（失败降级 0.5）。 */
export async function evaluateOneRubric(
  provider: LlmProvider,
  item: RubricPrompt,
  artifact: string,
): Promise<number> {
  try {
    const res = await provider.chat({
      jsonMode: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `评审维度：${item.prompt}\n\n提交物：\n${artifact}` },
      ],
    });
    return parseRubricScore(res.content) ?? 0.5;
  } catch {
    return 0.5; // 单条评审失败不阻塞评分
  }
}

/** 对全部 rubric item 评审，返回与 items 等长的 0–1 分数组。 */
export async function evaluateRubricWithLlm(
  provider: LlmProvider,
  items: RubricPrompt[],
  artifact: string,
): Promise<number[]> {
  return Promise.all(items.map((item) => evaluateOneRubric(provider, item, artifact)));
}
