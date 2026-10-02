import assert from "node:assert/strict";
import { test } from "node:test";

import { KnowledgeBase, SEED_CORPUS } from "./kb.js";
import {
  KeywordRetriever,
  scoreEntry,
  tokenize,
} from "./retriever.js";
import {
  getHint,
  rankDirections,
  recommendDirections,
} from "./recommend.js";
import { UNKNOWN_RESPONSE } from "./types.js";

const kb = KnowledgeBase.fromSeed();

test("tokenize：中英文分词", () => {
  const t = tokenize("RAG 检索问答");
  assert.ok(t.includes("rag"), "英文转小写并提取");
  assert.ok(t.includes("检索"), "中文 bigram");
  assert.ok(t.includes("索问"), "中文 bigram 逐字滑动");
});

test("scoreEntry：tag 命中权重高于词命中", () => {
  const tagScore = scoreEntry("rag", "……检索……", ["rag"]);
  const wordScore = scoreEntry("rag", "……rag……", []);
  assert.ok(tagScore >= 2, "tag 命中至少 2 分");
  assert.ok(wordScore >= 1 && wordScore < tagScore, "词命中得分低于 tag");
});

test("retrieve：按关键词召回方向，附得分排序", () => {
  const r = new KeywordRetriever(kb).retrieve("做一个 RAG 问答", { kind: "direction" });
  assert.equal(r.answered, true);
  assert.ok(r.hits.length >= 1);
  assert.equal(r.hits[0].entry.id, "dir-rag-qa", "最高分应是 RAG 方向");
});

test("retrieve：技能档过滤——低级档不召回高难度方向", () => {
  // dir-rag-qa 的 levelMin=2；query="rag" 能命中它，但 level=1 应被档位过滤掉
  const low = new KeywordRetriever(kb).retrieve("rag", { kind: "direction", level: 1 });
  assert.ok(!low.hits.some((h) => h.entry.id === "dir-rag-qa"), "level=1 不召回 rag 方向");
  const high = new KeywordRetriever(kb).retrieve("rag", { kind: "direction", level: 4 });
  assert.ok(high.hits.some((h) => h.entry.id === "dir-rag-qa"), "level=4 召回 rag 方向");
});

test("retrieve：未命中返回 answered=false", () => {
  const r = new KeywordRetriever(kb).retrieve("今天天气如何", { kind: "hint" });
  assert.equal(r.answered, false);
  assert.equal(r.hits.length, 0);
});

test("recommendDirections：不同技能档得到不同难度方向", () => {
  const beginner = recommendDirections(kb, 1).map((r) => r.entry.id);
  const advanced = recommendDirections(kb, 5).map((r) => r.entry.id);
  assert.ok(beginner.includes("dir-echo"));
  assert.ok(!beginner.includes("dir-tool-agent"));
  assert.ok(advanced.includes("dir-tool-agent"));
  assert.ok(!advanced.includes("dir-echo"), "高级档不含入门方向");
});

test("rankDirections：关键词对候选排序", () => {
  const ranked = rankDirections(kb, 4, "工具调用");
  assert.ok(ranked.length >= 1);
  assert.equal(ranked[0].entry.id, "dir-tool-agent", "工具关键词应把工具方向排最前");
});

test("getHint：命中返回提示与来源", () => {
  const h = getHint(kb, "检索结果怎么引用");
  assert.equal(h.answered, true);
  assert.ok(h.source, "含来源");
  assert.ok(h.text.length > 0);
});

test("getHint：未命中返回「不知道」", () => {
  const h = getHint(kb, "明天股票涨跌");
  assert.equal(h.answered, false);
  assert.equal(h.text, UNKNOWN_RESPONSE);
});

test("KnowledgeBase.add：同 id 覆盖，不同 id 追加", () => {
  const k = new KnowledgeBase();
  k.add([{ id: "x", text: "v1", source: "s", tags: [], kind: "direction" }]);
  k.add([{ id: "x", text: "v2", source: "s", tags: [], kind: "direction" }]);
  k.add([{ id: "y", text: "v3", source: "s", tags: [], kind: "hint" }]);
  assert.equal(k.size, 2);
  assert.equal(k.list().find((e) => e.id === "x")!.text, "v2");
});

test("SEED_CORPUS 覆盖方向与阶梯两类语料", () => {
  assert.ok(SEED_CORPUS.some((e) => e.kind === "direction"));
  assert.ok(SEED_CORPUS.some((e) => e.kind === "hint"));
});
