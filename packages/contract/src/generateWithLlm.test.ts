import { test } from "node:test";
import assert from "node:assert";
import type { LlmProvider } from "@cegueira/llm";
import { generateBundle } from "./generate.js";
import {
  generateBundleWithLlm,
  parseLlmDraft,
} from "./generateWithLlm.js";

function mockProvider(content: string): LlmProvider {
  return {
    id: "mock",
    async chat() {
      return { content };
    },
  };
}

const DRAFT = JSON.stringify({
  title: "客服问答 Agent",
  stages: [
    {
      id: "stage-1",
      name: "语料准备",
      tasks: [
        {
          id: "task-1",
          name: "切分入库",
          depends_on: [],
          weight: 1,
          acceptance: [{ type: "assert", expr: "doc_count >= 10", description: "至少 10 块" }],
        },
      ],
    },
    {
      id: "stage-2",
      name: "检索",
      tasks: [
        {
          id: "task-2",
          name: "向量化",
          depends_on: ["task-1"],
          weight: 0.5,
          acceptance: [{ type: "tool_call_in", tools: ["embed"], description: "仅 embed" }],
        },
        {
          id: "task-3",
          name: "检索接口",
          depends_on: ["task-2"],
          weight: 0.5,
          acceptance: [{ type: "no_loop", description: "无循环" }],
        },
      ],
    },
  ],
  rubrics: [
    { id: "clarity", prompt: "提示工程是否清晰" },
    { id: "grounding", prompt: "回答是否忠于检索" },
  ],
  tests: [
    {
      id: "test-basic",
      prompt: "怎么退货？",
      expected_outcome: "contains_retrieved_fact",
      data_flow_assertions: [{ source: "retrieval", field: "answer.cited_doc_ids" }],
      splits: "public",
      rewrites: ["如何申请退货"],
    },
    {
      id: "test-holdout",
      prompt: "运费谁出？",
      expected_outcome: "contains_retrieved_fact",
      data_flow_assertions: [],
      splits: "holdout",
      rewrites: [],
    },
  ],
});

test("parseLlmDraft：解析 JSON", () => {
  const d = parseLlmDraft(DRAFT);
  assert.ok(d);
  assert.equal(d!.title, "客服问答 Agent");
  assert.equal(d!.stages!.length, 2);
});

test("parseLlmDraft：markdown 包裹也能解析", () => {
  const d = parseLlmDraft("```json\n" + DRAFT + "\n```");
  assert.ok(d);
});

test("parseLlmDraft：非法内容返回 null", () => {
  assert.equal(parseLlmDraft("不是 JSON"), null);
  assert.equal(parseLlmDraft(""), null);
});

test("generateBundleWithLlm：LLM 成功产出定制契约", async () => {
  const provider = mockProvider(DRAFT);
  const bundle = await generateBundleWithLlm(
    provider,
    { direction: "客服问答", selfAssessment: "4" },
  );
  assert.equal(bundle.contract.title, "客服问答 Agent");
  assert.equal(bundle.contract.stages.length, 2);
  assert.equal(bundle.rubric.rubrics.length, 2);
  assert.equal(bundle.evalset.tests.length, 2);
  // 确定性部分被补全
  assert.equal(bundle.rubric.gates.security.length, 3);
  assert.equal(bundle.checks.length, 4);
});

test("generateBundleWithLlm：LLM 返回非法内容降级模板", async () => {
  const provider = mockProvider("乱七八糟");
  const bundle = await generateBundleWithLlm(
    provider,
    { direction: "RAG 问答" },
  );
  // 降级到模板：标题 = direction（generateBundle 对非空 direction 取 direction 本身）
  assert.equal(bundle.contract.title, "RAG 问答");
});

test("generateBundleWithLlm：provider 抛错降级模板", async () => {
  const provider: LlmProvider = {
    id: "boom",
    async chat() {
      throw new Error("down");
    },
  };
  const bundle = await generateBundleWithLlm(provider, { direction: "RAG 问答" });
  assert.equal(bundle.contract.title, "RAG 问答");
});

test("generateBundleWithLlm：结构不完整（缺 tests）降级模板", async () => {
  const incomplete = JSON.stringify({
    title: "x",
    stages: [{ id: "s1", name: "阶段", tasks: [] }],
    rubrics: [{ id: "r1", prompt: "p" }],
    // 缺 tests
  });
  const bundle = await generateBundleWithLlm(
    mockProvider(incomplete),
    { direction: "RAG 问答" },
  );
  assert.equal(bundle.contract.title, "RAG 问答");
});

test("sanitizeAcceptance：过滤非法 type（经 LLM 生成链路）", async () => {
  const bad = JSON.stringify({
    title: "t",
    stages: [
      {
        id: "s1",
        name: "阶段",
        tasks: [
          {
            id: "t1",
            name: "任务",
            depends_on: [],
            weight: 1,
            acceptance: [
              { type: "assert", expr: "x > 1" },
              { type: "unknown_type", expr: "bad" },
              { type: "tool_call_in", tools: ["a"] },
            ],
          },
        ],
      },
    ],
    rubrics: [{ id: "r1", prompt: "p" }],
    tests: [{ id: "t-b", prompt: "p", expected_outcome: "x", data_flow_assertions: [], splits: "public", rewrites: [] }],
  });
  const bundle = await generateBundleWithLlm(
    mockProvider(bad),
    { direction: "测试" },
  );
  // 非法 type 被过滤，只剩 assert 与 tool_call_in
  const acceptance = bundle.contract.stages[0].tasks[0].acceptance;
  assert.equal(acceptance.length, 2);
  assert.deepEqual(acceptance.map((a) => a.type), ["assert", "tool_call_in"]);
});
