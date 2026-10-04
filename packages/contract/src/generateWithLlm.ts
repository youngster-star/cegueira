/**
 * 契约生成器 LLM 化（PRD §6.1「按方向定制」）。
 *
 * 让 LLM 生成最需定制的部分（stages / rubric 条目 / 黄金测试集），
 * 确定性部分（projectMd、checks、gates、schema）由代码补全，降低 LLM
 * 产出非法契约的概率。生成后经 selfCheck 校验，失败降级回模板生成器。
 */
import type { LlmProvider } from "@cegueira/llm";
import { generateBundle, type GenerationInput } from "./generate.js";
import { selfCheck } from "./selfcheck.js";
import {
  SECURITY_ASSERTIONS,
  type Acceptance,
  type Contract,
  type ContractBundle,
  type EvalSet,
  type EvalTest,
  type ProjectMd,
  type Rubric,
  type RubricItem,
  type Stage,
} from "./types.js";

const SYSTEM_PROMPT =
  "你是 Cegueira 的契约生成器。根据用户的项目方向与技能自评，生成一份结构化开发契约。" +
  "只输出一个 JSON 对象，不要输出任何其他文字、注释或 markdown 代码块。" +
  "JSON 结构严格遵循：\n" +
  "{\n" +
  '  "title": "项目标题",\n' +
  '  "stages": [ { "id": "stage-1", "name": "阶段名", "tasks": [ { "id": "task-1", "name": "任务名", "depends_on": ["task-0"], "weight": 0.5, "acceptance": [ {"type":"assert","expr":"布尔表达式","description":"说明"} ] } ] } ],\n' +
  '  "rubrics": [ { "id": "clarity", "prompt": "评审维度描述" } ],\n' +
  '  "tests": [ { "id": "test-basic", "prompt": "测试题目", "expected_outcome": "期望结果", "data_flow_assertions": [{"source":"retrieval","field":"answer.cited_doc_ids"}], "splits": "public", "rewrites": ["改写1"] } ]\n' +
  "}\n" +
  "硬性要求：\n" +
  "- 3–4 个阶段，每阶段 1–3 个任务，任务数 4–6 个\n" +
  '- acceptance 的 type 只能是 assert / tool_call_in / no_loop / latency_lt 四者之一（tool_call_in 需带 tools 数组，latency_lt 需带 maxMs）\n' +
  "- 同一阶段内所有任务的 weight 之和必须为 1\n" +
  "- 2–3 个 rubric 评审维度\n" +
  "- 至少 2 个测试，其中一个 splits 为 holdout";

/** LLM 输出的可定制部分（不含 projectMd/checks/gates/schema）。 */
interface LlmContractDraft {
  title?: string;
  stages?: Stage[];
  rubrics?: RubricItem[];
  tests?: EvalTest[];
}

/** 从 LLM 文本解析 draft（宽容解析：去 markdown 包裹）。 */
export function parseLlmDraft(raw: string): LlmContractDraft | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as LlmContractDraft;
  } catch {
    return null;
  }
}

/** 校验 draft 是否可组装为合法契约（stages 与 rubrics 结构有效）。 */
function isUsableDraft(d: LlmContractDraft): d is Required<Pick<LlmContractDraft, "stages" | "rubrics" | "tests">> & { title?: string } {
  if (!Array.isArray(d.stages) || d.stages.length === 0) return false;
  if (!Array.isArray(d.rubrics) || d.rubrics.length === 0) return false;
  if (!Array.isArray(d.tests) || d.tests.length === 0) return false;
  return true;
}

/** 用代码补全确定性部分，组装成完整五件套。 */
function assembleBundle(input: GenerationInput, draft: LlmContractDraft, id: string): ContractBundle {
  const title = draft.title?.trim() || input.direction.trim() || "RAG 问答 Agent";

  const contract: Contract = {
    schema: "1.0",
    project_id: id,
    title,
    stages: draft.stages!.map((st, si) => ({
      ...st,
      id: st.id || `stage-${si + 1}`,
      tasks: st.tasks.map((t, ti) => ({
        ...t,
        id: t.id || `task-${si + 1}-${ti + 1}`,
        depends_on: Array.isArray(t.depends_on) ? t.depends_on : [],
        weight: Number.isFinite(t.weight) ? t.weight : 1,
        acceptance: sanitizeAcceptance(t.acceptance),
      })),
    })),
  };

  const rubric: Rubric = {
    schema: "1.0",
    mandatory_tests: draft.tests!.map((t) => t.id).slice(0, 2),
    gates: { security: [...SECURITY_ASSERTIONS], outcome_min: 0.3 },
    rubrics: draft.rubrics!.map((r) => ({ id: r.id, prompt: r.prompt })),
  };

  const evalset: EvalSet = {
    tests: draft.tests!.map((t) => ({
      id: t.id,
      prompt: t.prompt,
      expected_outcome: t.expected_outcome ?? "contains_retrieved_fact",
      data_flow_assertions: Array.isArray(t.data_flow_assertions)
        ? t.data_flow_assertions
        : [],
      splits: t.splits === "holdout" ? "holdout" : "public",
      rewrites: Array.isArray(t.rewrites) ? t.rewrites : [],
    })),
  };

  const projectMd: ProjectMd = {
    title,
    coreFunction: "根据语料库回答用户问题，并引用出处",
    coreTech: "Python + 向量检索 + 大模型生成",
    envPrereq: "Python 3.11+；本地 Ollama 或云端 API Key",
    coreDifficulty: "检索命中率与回答忠于检索内容（不幻觉）",
  };

  const checks = [
    { id: "l1-dangerous-eval", layer: "L1" as const, rule: "禁止 eval/exec 危险调用" },
    { id: "l1-hardcoded-key", layer: "L1" as const, rule: "禁止硬编码 API Key" },
    { id: "l2-tool-whitelist", layer: "L2" as const, rule: "工具调用落在契约白名单内" },
    { id: "l2-loop-detect", layer: "L2" as const, rule: "检测重复工具调用循环" },
  ];

  return { projectMd, contract, rubric, checks, evalset };
}

/** 清洗 acceptance 条目，过滤非法 type / 补默认字段。 */
function sanitizeAcceptance(list: unknown): Acceptance[] {
  if (!Array.isArray(list)) return [];
  const valid = new Set(["assert", "tool_call_in", "no_loop", "latency_lt"]);
  const out: Acceptance[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const a = item as Record<string, unknown>;
    if (!valid.has(a.type as string)) continue;
    out.push({
      type: a.type as Acceptance["type"],
      expr: typeof a.expr === "string" ? a.expr : undefined,
      tools: Array.isArray(a.tools) ? (a.tools as string[]).map(String) : undefined,
      maxMs: typeof a.maxMs === "number" ? a.maxMs : undefined,
      description: typeof a.description === "string" ? a.description : undefined,
    });
  }
  return out;
}

/**
 * 用 LLM 生成契约；解析/校验失败降级回模板生成器（不抛错，保证可用性）。
 */
export async function generateBundleWithLlm(
  provider: LlmProvider,
  input: GenerationInput,
  fallback: (i: GenerationInput) => ContractBundle = generateBundle,
): Promise<ContractBundle> {
  try {
    const res = await provider.chat({
      jsonMode: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `项目方向：${input.direction}\n` +
            `技能自评：${input.selfAssessment ?? "未提供"}\n`,
        },
      ],
    });
    const draft = parseLlmDraft(res.content);
    if (draft && isUsableDraft(draft)) {
      const bundle = assembleBundle(input, draft, crypto.randomUUID());
      const check = selfCheck(bundle);
      if (check.ok) return bundle;
    }
  } catch {
    /* LLM 不可用或产出非法 → 降级 */
  }
  return fallback(input);
}
