import assert from "node:assert/strict";
import { test } from "node:test";

import { KnowledgeBase } from "./kb.js";
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

test("scoreEntry：空 tag 不得恒命中（回归）", () => {
  assert.equal(scoreEntry("rag", "无关文本", [""]), 0);
  assert.equal(scoreEntry("今天天气", "回声机器人", [""]), 0);
  assert.equal(scoreEntry("rag", "无关文本", ["", "  "]), 0);
});

test("scoreEntry：空白 tag 视为无效", () => {
  assert.equal(scoreEntry("rag", "无关文本", ["   "]), 0);
});

test("retrieve：空 tag 条目不会被无关查询命中（回归）", () => {
  const kb = new KnowledgeBase();
  kb.add([{ id: "x", text: "无关文本", source: "s", tags: [""], kind: "hint" }]);
  const r = new KeywordRetriever(kb).retrieve("随便问");
  assert.equal(r.answered, false);
  assert.equal(r.hits.length, 0);
});

test("retrieve：空查询返回未命中", () => {
  const kb = KnowledgeBase.fromSeed();
  const r = new KeywordRetriever(kb).retrieve("   ");
  assert.equal(r.answered, false);
  assert.equal(r.hits.length, 0);
});

test("retrieve：minScore 过滤低分命中", () => {
  const kb = KnowledgeBase.fromSeed();
  const all = new KeywordRetriever(kb).retrieve("检索", { kind: "hint" });
  const strict = new KeywordRetriever(kb).retrieve("检索", { kind: "hint", minScore: 100 });
  assert.ok(all.answered);
  assert.equal(strict.answered, false);
});

test("retrieve：技能档边界 0 与 6", () => {
  const kb = KnowledgeBase.fromSeed();
  const lvl0 = new KeywordRetriever(kb).retrieve("回声", { kind: "direction", level: 0 });
  assert.ok(lvl0.hits.some((h) => h.entry.id === "dir-echo"), "level=0 含入门方向");
  const lvl6 = new KeywordRetriever(kb).retrieve("协作", { kind: "direction", level: 6 });
  assert.ok(lvl6.hits.some((h) => h.entry.id === "dir-multi-agent"), "level=6 含高级方向");
});

test("retrieve：level 超出所有方向 levelMax（6）返回未命中", () => {
  const kb = KnowledgeBase.fromSeed();
  const r = new KeywordRetriever(kb).retrieve("回声", { kind: "direction", level: 10 });
  assert.equal(r.answered, false);
});

test("tokenize：英文数字提取，标点忽略", () => {
  const t = tokenize("GPT-4 与 RAG2.0");
  assert.ok(t.includes("gpt"));
  assert.ok(t.includes("4"));
  assert.ok(t.includes("rag2"));
  assert.ok(!t.includes("-"), "标点不进入 token");
});

test("tokenize：单字中文不产生 bigram（已知行为，文档化）", () => {
  assert.deepEqual(tokenize("错"), []);
});

test("KnowledgeBase.add：同 id 覆盖且保留插入位置", () => {
  const k = new KnowledgeBase();
  k.add([
    { id: "a", text: "A1", source: "s", tags: [], kind: "direction" },
    { id: "b", text: "B1", source: "s", tags: [], kind: "direction" },
  ]);
  k.add([{ id: "a", text: "A2", source: "s", tags: [], kind: "direction" }]);
  assert.equal(k.size, 2);
  assert.equal(k.list()[0].text, "A2", "覆盖不改变顺序");
});

test("KnowledgeBase.list：无过滤返回全部", () => {
  const kb = KnowledgeBase.fromSeed();
  assert.equal(kb.list().length, kb.size);
});

test("recommendDirections：level 越界返回空（无匹配档位）", () => {
  const kb = KnowledgeBase.fromSeed();
  assert.deepEqual(recommendDirections(kb, -1), []);
  assert.deepEqual(recommendDirections(kb, 99), []);
});

test("rankDirections：无关关键词保持原顺序（全 0 分稳定排序）", () => {
  const kb = KnowledgeBase.fromSeed();
  const ranked = rankDirections(kb, 4, "完全不相关的词");
  const base = recommendDirections(kb, 4).map((r) => r.entry.id);
  assert.deepEqual(ranked.map((r) => r.entry.id), base, "全 0 分时顺序不变");
});

test("getHint：空话题返回「不知道」", () => {
  const kb = KnowledgeBase.fromSeed();
  const h = getHint(kb, "   ");
  assert.equal(h.answered, false);
  assert.equal(h.text, "不知道");
});
