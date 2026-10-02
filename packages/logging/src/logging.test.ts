import assert from "node:assert/strict";
import { test } from "node:test";

import { createLogger, formatEntry } from "./logger.js";

test("默认 info 级别过滤 debug", () => {
  const log = createLogger();
  log.debug("忽略我");
  log.info("记录我");
  const msgs = log.entries().map((e) => e.msg);
  assert.ok(!msgs.includes("忽略我"));
  assert.ok(msgs.includes("记录我"));
});

test("setLevel debug 后记录 debug", () => {
  const log = createLogger("warn");
  log.debug("d");
  log.info("i");
  log.setLevel("debug");
  log.debug("d2");
  const msgs = log.entries().map((e) => e.msg);
  assert.ok(!msgs.includes("d"));
  assert.ok(!msgs.includes("i"));
  assert.ok(msgs.includes("d2"));
});

test("entries 返回副本，写入序保持", () => {
  const log = createLogger("debug");
  log.info("a");
  log.error("b");
  log.warn("c");
  const levels = log.entries().map((e) => e.level);
  assert.deepEqual(levels, ["info", "error", "warn"]);
});

test("级别过滤边界：error 级别只记录 error", () => {
  const log = createLogger("error");
  log.warn("w");
  log.error("e");
  const levels = log.entries().map((e) => e.level);
  assert.deepEqual(levels, ["error"]);
});

test("meta 结构化记录", () => {
  const log = createLogger("debug");
  log.error("failed", { code: 500 });
  const e = log.entries()[0];
  assert.equal(e.meta?.code, 500);
});

test("formatEntry：含级别与消息", () => {
  const log = createLogger("debug");
  log.warn("磁盘将满", { used: 0.9 });
  const line = formatEntry(log.entries()[0]);
  assert.ok(line.includes("[WARN]"));
  assert.ok(line.includes("磁盘将满"));
  assert.ok(line.includes("0.9"));
});
