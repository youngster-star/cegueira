import { test } from "node:test";
import assert from "node:assert/strict";
import { stateOf, uncertainty } from "./uncertainty.js";

test("样本越多不确定度越低", () => {
  const now = new Date("2026-01-01");
  assert.ok(uncertainty(0, now, now) > uncertainty(5, now, now));
});

test("越久未评估不确定度越高", () => {
  const t0 = new Date("2026-01-01");
  const t30 = new Date("2026-01-31");
  assert.ok(uncertainty(1, t0, t30) > uncertainty(1, t30, t30));
});

test("三态判定", () => {
  assert.equal(stateOf(5.0, 0.8), "assessing"); // 不确定度高
  assert.equal(stateOf(4.6, 0.1), "near_boundary"); // 距 4.5 仅 0.1 < 0.3
  assert.equal(stateOf(5.0, 0.1), "confident");
});
