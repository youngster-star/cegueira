import assert from "node:assert/strict";
import { test } from "node:test";
import { KnowledgeBase } from "./kb.js";
import { getHintVector } from "./recommend.js";
import type { KnowledgeEntry } from "./types.js";
import { cosineSimilarity, VectorRetriever, type Embedder } from "./vector.js";

const DIM = 16;

/** 确定性假 embedder：字符袋向量（同字符越多越相似），无需联网。 */
function charBag(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (const ch of text) v[(ch.codePointAt(0) ?? 0) % DIM] += 1;
  return v;
}

const fakeEmbedder: Embedder = {
  id: "fake",
  async embed(texts) {
    return texts.map(charBag);
  },
};

function entry(id: string, text: string, kind: KnowledgeEntry["kind"]): KnowledgeEntry {
  return { id, text, source: `t#${id}`, tags: [], kind };
}

const KB = new KnowledgeBase([
  entry("fruit", "苹果 香蕉 水果 香甜 多汁", "hint"),
  entry("car", "汽车 轮胎 发动机 排量 马力", "hint"),
  entry("dir", "苹果 香蕉 方向模板", "direction"),
]);

test("cosineSimilarity：相同向量=1，零向量=0，维度不符抛错", () => {
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0); // 零向量 → 0（非 NaN）
  assert.throws(() => cosineSimilarity([1], [1, 2]), /维度不一致/);
});

test("VectorRetriever：按余弦相似度召回最相关条目", async () => {
  const r = new VectorRetriever(KB, fakeEmbedder);
  const res = await r.retrieve("香蕉 水果 香甜");
  assert.equal(res.answered, true);
  assert.equal(res.hits[0].entry.id, "fruit");
});

test("VectorRetriever：kind 过滤与空查询", async () => {
  const r = new VectorRetriever(KB, fakeEmbedder);
  const dirOnly = await r.retrieve("苹果 香蕉", { kind: "direction" });
  assert.deepEqual(
    dirOnly.hits.map((h) => h.entry.id),
    ["dir"],
  );
  const empty = await r.retrieve("   ");
  assert.deepEqual(empty, { hits: [], answered: false });
});

test("VectorRetriever：minScore 过高时未命中 → 回退「不知道」", async () => {
  const r = new VectorRetriever(KB, fakeEmbedder);
  const res = await r.retrieve("完全无关的词", { minScore: 0.99 });
  assert.equal(res.answered, false);
  assert.equal(res.hits.length, 0);
});

test("VectorRetriever：embedder 返回向量数不符时抛错", async () => {
  const bad: Embedder = { id: "bad", async embed() { return [[1, 2]]; } };
  const r = new VectorRetriever(KB, bad);
  await assert.rejects(() => r.retrieve("x"), /向量数.*条目数/);
});

test("VectorRetriever：topK 限制返回条数", async () => {
  const r = new VectorRetriever(KB, fakeEmbedder);
  const res = await r.retrieve("苹果 香蕉 水果 汽车", { topK: 1, minScore: 0 });
  assert.equal(res.hits.length, 1);
});

test("getHintVector：语义召回并附来源；未命中回退「不知道」", async () => {
  const hit = await getHintVector(KB, "香蕉 水果 香甜", fakeEmbedder);
  assert.equal(hit.answered, true);
  assert.equal(hit.source, "t#fruit");

  // 单条目 KB + 正交 embedder：查询与条目正交 → 未命中
  const oneKB = new KnowledgeBase([entry("only", "苹果 香蕉", "hint")]);
  const ortho: Embedder = {
    id: "ortho",
    async embed(texts) {
      return texts.map((t) => (t.includes("苹果") ? [1, 0] : [0, 1]));
    },
  };
  const miss = await getHintVector(oneKB, "完全无关的词", ortho);
  assert.equal(miss.answered, false);
  assert.equal(miss.text, "不知道");
});
