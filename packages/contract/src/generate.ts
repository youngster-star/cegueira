/**
 * 契约生成器：方向 + 技能自评 → 五件套（PRD §6.1）。
 * P1 使用内置模板生成（针对 RAG 问答 Agent）；LLM 生成接口留占位，后续接入。
 */
import {
  CONTRACT_SCHEMA,
  SECURITY_ASSERTIONS,
  type Contract,
  type ContractBundle,
  type EvalSet,
  type ProjectMd,
  type Rubric,
} from "./types.js";

/** 生成输入：方向 + 技能自评。 */
export interface GenerationInput {
  direction: string;
  selfAssessment?: string;
  /**
   * 覆盖模板默认的「变更类工具」声明（PRD §4.6 安全断言之一）。
   *
   * 缺省用模板默认值。不提供的话，生成的契约就不含 `mutating_tools`，
   * 评分时 `no_unauthorized_mutation` 只能「未声明 → 默认放行」——
   * 相当于安全门控的三条断言里有一条形同虚设。因此模板改为默认声明。
   */
  mutatingTools?: string[];
}

/**
 * 全流程允许的 Agent 级工具（全局白名单）。
 *
 * 为什么是**一份**而非按阶段拆分：单轨迹模型下 `tool_call_in` 会拿整条轨迹的全部
 * 工具调用来判定（`acceptance.ts:114`：任一越界即整条不通过），因此它本质是全局
 * 策略。若按阶段给互斥子集（入库只许 chunk/embed/index、生成只许 retrieve/generate），
 * 任何**用了工具**的 Agent 都必违反其一，只有不用工具的 Agent 才能靠 `every([])`
 * 空洞全过——契约变得不可满足。故统一为一份白名单，挂在首个任务上。
 */
const TOOL_WHITELIST = ["chunk", "embed", "index", "retrieve", "generate"] as const;

/** 内置模板：RAG 问答 Agent 的契约五件套。 */
export function generateBundle(input: GenerationInput, projectId?: string): ContractBundle {
  const id = projectId ?? crypto.randomUUID();
  const title = input.direction.trim() || "RAG 问答 Agent";

  const projectMd: ProjectMd = {
    title,
    coreFunction: "根据语料库回答用户问题，并引用出处",
    coreTech: "Python + 向量检索 + 大模型生成",
    envPrereq: "Python 3.11+；OpenAI/Anthropic API Key",
    coreDifficulty: "检索命中率与回答忠于检索内容（不幻觉）",
  };

  const contract: Contract = {
    schema: CONTRACT_SCHEMA,
    project_id: id,
    title,
    // 变更类（有副作用）工具的显式声明：RAG 模板里只有 index 会写入向量库；
    // chunk/embed/retrieve/generate 均为只读或纯计算。声明后安全门控的
    // no_unauthorized_mutation 才真正参与判定（否则恒为「默认放行」）。
    mutating_tools: input.mutatingTools ?? ["index"],
    stages: [
      {
        id: "stage-1",
        name: "语料准备",
        tasks: [
          {
            id: "task-1",
            name: "切分并入库",
            depends_on: [],
            weight: 1.0,
            // 本阶段观测到的只有「调了什么工具、花了多久」——检索类事实要等 stage-2
            // 才有值（doc_count 在无检索的轨迹里恒为 0，写在这里会永远不通过）。
            acceptance: [
              {
                type: "tool_call_in",
                tools: [...TOOL_WHITELIST],
                description: "全流程仅允许白名单内的工具（单轨迹模型的全局策略）",
              },
              { type: "latency_lt", maxMs: 5000, description: "入库耗时 < 5s" },
            ],
          },
        ],
      },
      {
        id: "stage-2",
        name: "检索构建",
        tasks: [
          {
            id: "task-2",
            name: "向量化与索引",
            depends_on: ["task-1"],
            weight: 0.4,
            acceptance: [
              // 工具白名单已在 task-1 全局声明，此处不再重复（避免同一信号被多任务重复计权）。
              {
                type: "assert",
                expr: "success_rate >= 0.9",
                description: "索引过程无失败调用（工具调用成功率 ≥ 0.9）",
              },
            ],
          },
          {
            id: "task-3",
            name: "检索接口",
            depends_on: ["task-2"],
            weight: 0.6,
            acceptance: [
              { type: "assert", expr: "retrieval_hit_rate >= 0.9", description: "检索命中率 ≥ 0.9" },
              { type: "no_loop", description: "检索无死循环" },
            ],
          },
        ],
      },
      {
        id: "stage-3",
        name: "问答生成",
        tasks: [
          {
            id: "task-4",
            name: "生成回答",
            depends_on: ["task-3"],
            weight: 0.5,
            acceptance: [
              // 工具白名单已在 task-1 全局声明，此处不再重复。
              { type: "assert", expr: "answer_has_citation", description: "回答含引用" },
            ],
          },
          {
            id: "task-5",
            name: "引用溯源",
            depends_on: ["task-4"],
            weight: 0.5,
            acceptance: [
              {
                type: "assert",
                expr: "cited_doc_ids ⊆ retrieval_doc_ids",
                description: "引用忠于检索：答案引用的每个文档都出自检索结果",
              },
            ],
          },
        ],
      },
    ],
  };

  const rubric: Rubric = {
    schema: CONTRACT_SCHEMA,
    mandatory_tests: ["test-basic", "test-rewrite"],
    gates: {
      security: [...SECURITY_ASSERTIONS],
      outcome_min: 0.3,
    },
    rubrics: [
      { id: "clarity", prompt: "评估提示工程是否清晰" },
      { id: "architecture", prompt: "评估模块划分是否合理" },
    ],
  };

  const checks = [
    { id: "l1-dangerous-eval", layer: "L1" as const, rule: "禁止 eval/exec 危险调用" },
    { id: "l1-hardcoded-key", layer: "L1" as const, rule: "禁止硬编码 API Key" },
    { id: "l2-tool-whitelist", layer: "L2" as const, rule: "工具调用落在契约白名单内" },
    { id: "l2-loop-detect", layer: "L2" as const, rule: "检测重复工具调用循环" },
  ];

  const evalset: EvalSet = {
    tests: [
      {
        id: "test-basic",
        prompt: "什么是 RAG？",
        expected_outcome: "contains_retrieved_fact",
        data_flow_assertions: [{ source: "retrieval", field: "answer.cited_doc_ids" }],
        splits: "public",
        rewrites: ["用一句话解释 RAG", "RAG 的全称和原理"],
      },
      {
        id: "test-rewrite",
        prompt: "RAG 相比纯生成有什么优势？",
        expected_outcome: "contains_retrieved_fact",
        data_flow_assertions: [{ source: "retrieval", field: "answer.cited_doc_ids" }],
        splits: "holdout",
        rewrites: ["为什么 RAG 能减少幻觉", "检索增强生成解决了什么问题"],
      },
    ],
  };

  return { projectMd, contract, rubric, checks, evalset };
}

// ---- 序列化（落盘用，供 CLI 写入五件套文件） ----

/** project.md 序列化为 Markdown（PRD 开发文档 §7.1）。 */
export function projectMdToMarkdown(pm: ProjectMd): string {
  return [
    `# ${pm.title}`,
    "",
    `- 核心功能：${pm.coreFunction}`,
    `- 核心技术：${pm.coreTech}`,
    `- 环境前提：${pm.envPrereq}`,
    `- 核心难点：${pm.coreDifficulty}`,
    "",
  ].join("\n");
}

/** contract.json 序列化。 */
export function contractToJson(c: Contract): string {
  return JSON.stringify(c, null, 2);
}

/** rubric.yaml 序列化（结构固定，手写避免引入 YAML 依赖）。 */
export function rubricToYaml(r: Rubric): string {
  const lines: string[] = [`schema: "${r.schema}"`];
  lines.push("mandatory_tests:");
  for (const t of r.mandatory_tests) lines.push(`  - "${t}"`);
  lines.push("gates:");
  lines.push("  security:");
  for (const s of r.gates.security) lines.push(`    - ${s}`);
  lines.push(`  outcome_min: ${r.gates.outcome_min}`);
  lines.push("rubrics:");
  for (const item of r.rubrics) {
    lines.push(`  - id: ${item.id}`);
    lines.push(`    prompt: "${item.prompt}"`);
  }
  return lines.join("\n") + "\n";
}

/** evalset 序列化。 */
export function evalsetToJson(e: EvalSet): string {
  return JSON.stringify(e, null, 2);
}
