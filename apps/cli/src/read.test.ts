import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJson, readText } from "./read.js";

test("readText/readJson：剥离 UTF-8 BOM（Windows 常见）", () => {
  const dir = mkdtempSync(join(tmpdir(), "ceg-read-"));
  try {
    const bom = join(dir, "bom.json");
    writeFileSync(bom, "\uFEFF{\"a\":1}"); // 前导 BOM
    assert.equal(readText(bom), '{"a":1}');
    assert.deepEqual(readJson(bom), { a: 1 });

    const plain = join(dir, "plain.json");
    writeFileSync(plain, '{"b":2}');
    assert.deepEqual(readJson(plain), { b: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
