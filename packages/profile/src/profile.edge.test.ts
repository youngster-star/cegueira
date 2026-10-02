import { test } from "node:test";
import assert from "node:assert/strict";
import { LEVELS, levelOf } from "./levels.js";
import {
  DEFAULT_PARAMS,
  isNearBoundary,
  stateOf,
  uncertainty,
} from "./uncertainty.js";

// ---------- levels 边界 ----------

test("六档名称与区间完整且连续", () => {
  assert.equal(LEVELS.length, 6);
  assert.deepEqual(
    LEVELS.map((l) => l.name),
    ["起步", "基础", "基本掌握", "熟练", "精通", "大师"],
  );
  // 区间连续性：前一档 max == 后一档 min
  for (let i = 0; i < LEVELS.length - 1; i++) {
    assert.equal(LEVELS[i].max, LEVELS[i + 1].min, `档 ${i} 与 ${i + 1} 不连续`);
  }
});

test("浮点边界：6.499 归第 3 档、6.5 归第 4 档", () => {
  assert.equal(levelOf(6.499).level, 3);
  assert.equal(levelOf(6.5).level, 4);
  assert.equal(levelOf(2.0000001).level, 2);
});

test("非有限数全部抛错", () => {
  assert.throws(() => levelOf(Infinity));
  assert.throws(() => levelOf(-Infinity));
  assert.throws(() => levelOf(NaN));
});

// ---------- uncertainty 边界 ----------

test("uncertainty 精确公式：base/(1+n) + lambda*days", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  // n=0, days=0 → 1.0
  assert.equal(uncertainty(0, now, now), DEFAULT_PARAMS.base);
  // n=1, days=0 → 1/(1+1)=0.5
  assert.ok(Math.abs(uncertainty(1, now, now) - 0.5) < 1e-9);
  // n=3 → 0.25
  assert.ok(Math.abs(uncertainty(3, now, now) - 0.25) < 1e-9);
});

test("lastAssessedAt 晚于 now（未来时间）时天数归零不返负", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const future = new Date("2026-02-01T00:00:00Z");
  const u = uncertainty(0, future, now);
  // 应等于 days=0 的结果，而非负数
  assert.equal(u, uncertainty(0, now, now));
  assert.ok(u >= 0);
});

test("遗忘系数：30 天后不确定度上升", () => {
  const t0 = new Date("2026-01-01T00:00:00Z");
  const t30 = new Date("2026-01-31T00:00:00Z");
  const u0 = uncertainty(5, t0, t0);
  const u30 = uncertainty(5, t0, t30);
  // 增量 = lambda * 30 = 0.6
  assert.ok(Math.abs(u30 - u0 - 0.6) < 1e-9);
});

test("isNearBoundary：靠近档位下界或上界均为真", () => {
  // 5.0 距第 3 档下界 4.5 差 0.5 > 0.3 → false
  assert.equal(isNearBoundary(5.0), false);
  // 4.6 距下界 4.5 差 0.1 → true
  assert.equal(isNearBoundary(4.6), true);
  // 6.4 距第 3 档上界 6.5 差 0.1 → true
  assert.equal(isNearBoundary(6.4), true);
});

test("stateOf 边界：u 恰等于 uHigh 时不判 assessing", () => {
  // u == 0.5（uHigh）且不靠边界 → confident（而非 assessing）
  assert.equal(stateOf(5.0, DEFAULT_PARAMS.uHigh), "confident");
  // u 略高于 uHigh → assessing
  assert.equal(stateOf(5.0, DEFAULT_PARAMS.uHigh + 0.01), "assessing");
});

test("stateOf 优先级：不确定度高优先于靠近边界", () => {
  // 4.6 既靠近边界（4.5+0.1）又不确定度高（0.8 > 0.5）→ assessing
  assert.equal(stateOf(4.6, 0.8), "assessing");
});
