import { test } from "node:test";
import assert from "node:assert";
import { createBudget } from "./index.js";

test("预算：70% 警告、90% 降级、100% 硬中断", () => {
  const b = createBudget(100);
  assert.equal(b.consume(50).state, "normal"); // 50%
  assert.equal(b.consume(20).state, "warned"); // 70%
  assert.equal(b.consume(20).state, "degraded"); // 90%
  assert.equal(b.consume(10).state, "halted"); // 100%
});

test("预算：halted 后 canSpend=false，且继续累计", () => {
  const b = createBudget(100);
  b.consume(100);
  const s = b.status();
  assert.equal(s.state, "halted");
  assert.equal(s.canSpend, false);
  const over = b.consume(10); // 超额仍累计
  assert.equal(over.used, 110);
  assert.equal(over.usedRatio, 1.1);
  assert.equal(over.remaining, 0);
});

test("预算：精确边界值（69.9 / 70 / 89.9 / 90）", () => {
  const b = createBudget(100);
  assert.equal(b.consume(69.9).state, "normal");
  assert.equal(b.consume(0.1).state, "warned"); // 70.0
  const c = createBudget(100);
  c.consume(89.9);
  assert.equal(c.consume(0.1).state, "degraded"); // 90.0
});

test("预算：非法上限抛错", () => {
  assert.throws(() => createBudget(0), RangeError);
  assert.throws(() => createBudget(-5), RangeError);
  assert.throws(() => createBudget(NaN), RangeError);
});

test("预算：非法阈值顺序抛错", () => {
  assert.throws(() => createBudget(100, { warn: 0.9, degrade: 0.7 }), RangeError);
  assert.throws(() => createBudget(100, { degrade: 1.2 }), RangeError);
});

test("预算：非法消耗量抛错", () => {
  const b = createBudget(100);
  assert.throws(() => b.consume(-1), RangeError);
  assert.throws(() => b.consume(NaN), RangeError);
});

test("预算：自定义阈值生效", () => {
  const b = createBudget(100, { warn: 0.5, degrade: 0.8, halt: 1.0 });
  assert.equal(b.consume(50).state, "warned");
  assert.equal(b.consume(30).state, "degraded");
});
