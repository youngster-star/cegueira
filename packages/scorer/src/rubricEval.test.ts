import { test } from "node:test";
import assert from "node:assert";
import type { LlmProvider } from "@cegueira/llm";
import {
  evaluateRubricWithLlm,
  parseRubricScore,
} from "./rubricEval.js";

function mockProvider(responses: string[]): LlmProvider {
  let i = 0;
  return {
    id: "mock",
    async chat() {
      const content = responses[Math.min(i, responses.length - 1)];
      i++;
      return { content };
    },
  };
}

test("parseRubricScore：标准 JSON", () => {
  assert.equal(parseRubricScore('{"score": 0.8, "reason": "ok"}'), 0.8);
});

test("parseRubricScore：markdown 代码块包裹", () => {
  assert.equal(parseRubricScore("```json\n{\"score\": 0.6}\n```"), 0.6);
});

test("parseRubricScore：前缀文本 + JSON", () => {
  assert.equal(parseRubricScore("评分如下：{\"score\": 0.9}"), 0.9);
});

test("parseRubricScore：百分制归一化", () => {
  assert.equal(parseRubricScore('{"score": 80}'), 0.8);
});

test("parseRubricScore：裸数字兜底", () => {
  assert.equal(parseRubricScore("0.75"), 0.75);
});

test("parseRubricScore：越界裁剪", () => {
  assert.equal(parseRubricScore('{"score": 1.5}'), 1);
  assert.equal(parseRubricScore('{"score": -0.2}'), 0);
});

test("parseRubricScore：无效内容返回 null", () => {
  assert.equal(parseRubricScore("完全没有分数"), null);
  assert.equal(parseRubricScore(""), null);
});

test("evaluateRubricWithLlm：解析各条目分数", async () => {
  const provider = mockProvider(['{"score":0.7}', '{"score":0.9}']);
  const scores = await evaluateRubricWithLlm(
    provider,
    [
      { id: "clarity", prompt: "评估清晰度" },
      { id: "architecture", prompt: "评估架构" },
    ],
    "提交物内容",
  );
  assert.deepEqual(scores, [0.7, 0.9]);
});

test("evaluateRubricWithLlm：解析失败降级 0.5", async () => {
  const provider = mockProvider(["无法解析的内容"]);
  const scores = await evaluateRubricWithLlm(
    provider,
    [{ id: "x", prompt: "评估" }],
    "内容",
  );
  assert.deepEqual(scores, [0.5]);
});

test("evaluateRubricWithLlm：provider 抛错降级 0.5", async () => {
  const provider: LlmProvider = {
    id: "boom",
    async chat() {
      throw new Error("network down");
    },
  };
  const scores = await evaluateRubricWithLlm(
    provider,
    [{ id: "x", prompt: "评估" }],
    "内容",
  );
  assert.deepEqual(scores, [0.5]);
});
