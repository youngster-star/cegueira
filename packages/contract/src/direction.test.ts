import assert from "node:assert/strict";
import { test } from "node:test";

import { recommendDirections } from "./direction.js";

test("recommendDirections：入门档推荐入门方向", () => {
  const recs = recommendDirections(1);
  const ids = recs.map((r) => r.entry.id);
  assert.ok(ids.includes("dir-echo"), "入门档含回声方向");
  assert.ok(!ids.includes("dir-tool-agent"), "入门档不含工具方向");
  assert.ok(!ids.includes("dir-multi-agent"), "入门档不含多 Agent 方向");
});

test("recommendDirections：高级档推荐高级方向", () => {
  const recs = recommendDirections(5);
  const ids = recs.map((r) => r.entry.id);
  assert.ok(ids.includes("dir-tool-agent"));
  assert.ok(ids.includes("dir-multi-agent"));
  assert.ok(!ids.includes("dir-echo"), "高级档不含入门方向");
});

test("recommendDirections：偏好词影响排序", () => {
  const recs = recommendDirections(4, "工具调用");
  assert.ok(recs.length >= 1);
  assert.equal(recs[0].entry.id, "dir-tool-agent", "工具偏好把工具方向排最前");
});

test("recommendDirections：每条推荐附可追溯来源", () => {
  for (const r of recommendDirections(3)) {
    assert.ok(r.entry.source.length > 0, "含来源");
  }
});
