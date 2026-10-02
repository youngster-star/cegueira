import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LEVEL,
  explainL4,
  initialState,
  isOverReliant,
  onStuck,
  requestUpgrade,
} from "./ladder.js";

test("initialState 完整字段", () => {
  const s = initialState();
  assert.deepEqual(s, {
    level: DEFAULT_LEVEL,
    rejections: 0,
    l3Requests: 0,
    l4Requests: 0,
    l4Explained: false,
  });
});

test("onStuck 递增 rejections 计数", () => {
  let s = initialState();
  s = onStuck(s);
  assert.equal(s.rejections, 1);
  s = onStuck(s);
  assert.equal(s.rejections, 2);
});

test("onStuck 从 L2 连续卡住封顶 L4，不再增长", () => {
  let s = initialState();
  s = onStuck(s); // L2 -> L3
  assert.equal(s.level, 3);
  s = onStuck(s); // L3 -> L4
  assert.equal(s.level, 4);
  const levelBefore = s.level;
  s = onStuck(s); // 封顶
  assert.equal(s.level, levelBefore);
});

test("requestUpgrade 到 L3 递增 l3Requests", () => {
  const s = requestUpgrade(initialState(), 3);
  assert.equal(s.level, 3);
  assert.equal(s.l3Requests, 1);
  assert.equal(s.l4Requests, 0);
});

test("requestUpgrade 到 L4 递增 l4Requests 且不影响 l3", () => {
  const s = requestUpgrade(initialState(), 4);
  assert.equal(s.level, 4);
  assert.equal(s.l4Requests, 1);
  assert.equal(s.l3Requests, 0);
});

test("requestUpgrade 目标 <3 抛错（0/1/2 均不可主动升级）", () => {
  assert.throws(() => requestUpgrade(initialState(), 0 as never));
  assert.throws(() => requestUpgrade(initialState(), 1 as never));
  assert.throws(() => requestUpgrade(initialState(), 2 as never));
});

test("explainL4 只翻转 l4Explained，不改其它状态", () => {
  const s = requestUpgrade(initialState(), 4);
  const e = explainL4(s);
  assert.equal(e.l4Explained, true);
  assert.equal(e.level, s.level);
  assert.equal(e.l4Requests, s.l4Requests);
});

test("isOverReliant：默认 false，超过阈值 true", () => {
  assert.equal(isOverReliant(initialState()), false);
  // 4 次 L3 请求 > 3 阈值
  const heavy = { ...initialState(), l3Requests: 4 };
  assert.equal(isOverReliant(heavy), true);
});

test("isOverReliant：恰好等于阈值不算过度依赖（> 阈值才触发）", () => {
  const s = { ...initialState(), l3Requests: 2, l4Requests: 1 }; // 合计 3
  assert.equal(isOverReliant(s), false);
  const s2 = { ...initialState(), l3Requests: 2, l4Requests: 2 }; // 合计 4
  assert.equal(isOverReliant(s2), true);
});

test("L4 未解释时技能分不应升级（状态区分）", () => {
  const s = requestUpgrade(initialState(), 4);
  assert.equal(s.l4Explained, false);
  assert.equal(explainL4(s).l4Explained, true);
});
