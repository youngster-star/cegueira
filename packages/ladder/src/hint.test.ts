import assert from "node:assert/strict";
import { test } from "node:test";

import { knowledgeHint } from "./hint.js";
import { UNKNOWN_RESPONSE } from "@cegueira/rag";

test("knowledgeHint：命中返回提示与来源", () => {
  const h = knowledgeHint("检索结果如何引用出处");
  assert.equal(h.answered, true);
  assert.ok(h.source, "含来源");
  assert.ok(h.text.length > 0);
});

test("knowledgeHint：未命中返回「不知道」", () => {
  const h = knowledgeHint("明天股票涨跌预测");
  assert.equal(h.answered, false);
  assert.equal(h.text, UNKNOWN_RESPONSE);
});
