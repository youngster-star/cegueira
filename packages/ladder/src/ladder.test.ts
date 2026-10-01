import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LEVEL, explainL4, initialState, onStuck, requestUpgrade } from "./ladder.js";

test("默认停在 L2", () => {
  assert.equal(initialState().level, DEFAULT_LEVEL);
});

test("卡住解锁下一级（封顶 L4）", () => {
  let s = initialState();
  s = onStuck(s);
  assert.equal(s.level, 3);
  s = onStuck(s);
  assert.equal(s.level, 4);
  s = onStuck(s);
  assert.equal(s.level, 4);
});

test("L3+ 需主动升级，L0–L2 不可主动升级", () => {
  const s = requestUpgrade(initialState(), 4);
  assert.equal(s.level, 4);
  assert.equal(s.l4Requests, 1);
  assert.throws(() => requestUpgrade(initialState(), 2));
});

test("L4 解释后才能升级技能分", () => {
  const s = requestUpgrade(initialState(), 4);
  assert.equal(s.l4Explained, false);
  assert.equal(explainL4(s).l4Explained, true);
});
