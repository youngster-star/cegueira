import { test } from "node:test";
import assert from "node:assert/strict";
import { levelOf } from "./levels.js";

test("分档边界正确（左闭右开，10.0 归最后一档）", () => {
  assert.equal(levelOf(0).level, 1);
  assert.equal(levelOf(1.9).level, 1);
  assert.equal(levelOf(2.0).level, 2);
  assert.equal(levelOf(4.5).level, 3);
  assert.equal(levelOf(6.5).level, 4);
  assert.equal(levelOf(8.0).level, 5);
  assert.equal(levelOf(9.0).level, 6);
  assert.equal(levelOf(10.0).level, 6);
});

test("越界抛错", () => {
  assert.throws(() => levelOf(-1));
  assert.throws(() => levelOf(10.1));
  assert.throws(() => levelOf(NaN));
});
