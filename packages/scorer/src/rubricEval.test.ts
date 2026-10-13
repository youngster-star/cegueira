import { test } from "node:test";
import assert from "node:assert";
import type { LlmProvider } from "@cegueira/llm";
import {
  buildRubricMessages,
  evaluateRubricCrossFamily,
  evaluateRubricWithLlm,
  parseRubricScore,
  ratingToUnit,
  RUBRIC_SYSTEM_PROMPT,
} from "./rubricEval.js";

/** 构造返回固定内容的 provider。 */
function fixedProvider(id: string, content: string): LlmProvider {
  return { id, async chat() { return { content }; } };
}

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

// ---- 新版 1–5 整数量表（reasoning 先于 rating） ----

test("ratingToUnit：1–5 线性映射到 0–1，越界裁剪", () => {
  assert.equal(ratingToUnit(1), 0);
  assert.equal(ratingToUnit(3), 0.5);
  assert.equal(ratingToUnit(5), 1);
  assert.equal(ratingToUnit(9), 1, "越界上裁");
  assert.equal(ratingToUnit(-2), 0, "越界下裁");
  assert.equal(ratingToUnit(3.6), 0.75, "先四舍五入（4→0.75）");
});

test("parseRubricScore：新格式 rating（1–5）优先于旧 score", () => {
  assert.equal(parseRubricScore('{"reasoning":"清晰","rating":4}'), 0.75);
  assert.equal(parseRubricScore('{"rating": 1}'), 0);
  assert.equal(parseRubricScore('{"rating": 5}'), 1);
  // 同时存在时以 rating 为准
  assert.equal(parseRubricScore('{"rating":5,"score":0.1}'), 1);
});

test("parseRubricScore：rating 的 kv / 裸写法兜底", () => {
  assert.equal(parseRubricScore("rating = 3"), 0.5);
  assert.equal(parseRubricScore("...\nrating:5\n..."), 1);
});

test("buildRubricMessages：含安全约束、分隔标签与维度", () => {
  const msgs = buildRubricMessages({ id: "clarity", prompt: "评估清晰度" }, "用户代码");
  assert.equal(msgs[0].role, "system");
  assert.match(msgs[0].content, /不可信数据/);
  assert.match(msgs[0].content, /长度不代表质量/);
  assert.equal(RUBRIC_SYSTEM_PROMPT, msgs[0].content);
  assert.equal(msgs[1].role, "user");
  assert.match(msgs[1].content, /评估清晰度/);
  assert.match(msgs[1].content, /<artifact>[\s\S]*用户代码[\s\S]*<\/artifact>/);
});

test("evaluateRubricCrossFamily：逐条目跨家族取中位数", async () => {
  const a = fixedProvider("familyA", '{"rating":5}'); // 1.0
  const b = fixedProvider("familyB", '{"rating":2}'); // 0.25
  const c = fixedProvider("familyC", '{"rating":3}'); // 0.5
  const scores = await evaluateRubricCrossFamily(
    [a, b, c],
    [{ id: "x", prompt: "评估" }],
    "内容",
  );
  // median(1, 0.25, 0.5) = 0.5
  assert.deepEqual(scores, [0.5]);
});

test("evaluateRubricCrossFamily：无 provider 抛错，不静默给分", async () => {
  await assert.rejects(
    () => evaluateRubricCrossFamily([], [{ id: "x", prompt: "评估" }], "内容"),
    /至少需要一个 provider/,
  );
});

test("evaluateRubricCrossFamily：单家族失败降级 0.5 但其余照常", async () => {
  const ok = fixedProvider("ok", '{"rating":5}'); // 1.0
  const boom: LlmProvider = { id: "boom", async chat() { throw new Error("down"); } }; // 0.5
  const scores = await evaluateRubricCrossFamily(
    [ok, boom],
    [{ id: "x", prompt: "评估" }],
    "内容",
  );
  // median(1, 0.5) = 0.75
  assert.deepEqual(scores, [0.75]);
});
