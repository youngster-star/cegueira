import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_LEVEL_MAX,
  DEFAULT_LEVEL,
  explainL4,
  initialState,
  onStuck,
  requestUpgrade,
  type LadderState,
} from "./ladder.js";

test("默认停在 L2", () => {
  assert.equal(initialState().level, DEFAULT_LEVEL);
});

test("卡住只在自动上限内解锁（封顶 L2，L3+ 需主动升级）", () => {
  // 从 L0 起（例如引导不足时的初始状态）逐级解锁
  let s: LadderState = { ...initialState(), level: 0 };
  s = onStuck(s);
  assert.equal(s.level, 1);
  s = onStuck(s);
  assert.equal(s.level, 2);
  s = onStuck(s);
  assert.equal(s.level, AUTO_LEVEL_MAX); // 封顶，不再自动升到 L3/L4
  // 默认已在 L2：反复卡住不抬升级别，仅累积 rejections
  const at2 = onStuck(initialState());
  assert.equal(at2.level, 2);
  assert.equal(at2.rejections, 1);
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
