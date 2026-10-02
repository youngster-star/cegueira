import assert from "node:assert/strict";
import { test } from "node:test";

import { createLogger, formatEntry } from "./logger.js";
import { LEVEL_ORDER } from "./types.js";

test("setLevel：debug 级别保留所有", () => {
  const log = createLogger("info");
  log.setLevel("debug");
  log.debug("d");
  log.info("i");
  log.warn("w");
  log.error("e");
  assert.equal(log.entries().length, 4);
});

test("setLevel：error 级别仅保留 error", () => {
  const log = createLogger("info");
  log.setLevel("error");
  log.warn("w");
  log.error("e");
  assert.deepEqual(log.entries().map((e) => e.level), ["error"]);
});

test("entries 返回副本：修改返回值不影响内部", () => {
  const log = createLogger("debug");
  log.info("a");
  const e1 = log.entries();
  e1.push({ ts: "", level: "error", msg: "注入" });
  assert.equal(log.entries().length, 1, "内部不受外部 push 影响");
});

test("entries 写入序稳定", () => {
  const log = createLogger("debug");
  const seq = ["error", "debug", "info", "warn"] as const;
  seq.forEach((l, i) => log[l](String(i)));
  assert.deepEqual(log.entries().map((e) => e.level), [...seq]);
});

test("formatEntry：无 meta 时无多余尾随", () => {
  const log = createLogger("debug");
  log.info("纯消息");
  const line = formatEntry(log.entries()[0]);
  assert.equal(line.endsWith("纯消息"), true);
  assert.ok(line.includes("[INFO]"));
});

test("formatEntry：空对象 meta 忠实序列化为 {}（文档化行为）", () => {
  const log = createLogger("debug");
  log.info("m", {});
  const line = formatEntry(log.entries()[0]);
  assert.equal(line.includes("{}"), true, "空对象 meta 保留为 {}");
});

test("LEVEL_ORDER：级别递增排序", () => {
  assert.deepEqual(LEVEL_ORDER, ["debug", "info", "warn", "error"]);
});

test("meta 引用语义：调用方后续修改影响已记录 entry（浅拷贝语义）", () => {
  const log = createLogger("debug");
  const meta = { code: 1 };
  log.info("m", meta);
  meta.code = 2;
  assert.equal(log.entries()[0].meta?.code, 2, "meta 为共享引用");
});
