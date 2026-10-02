import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";

import {
  defaultDataDir,
  resolveDataDir,
} from "./dataDir.js";
import {
  createBackupManifest,
  formatBytes,
  manifestSummary,
} from "./backup.js";

test("defaultDataDir：Windows 用 APPDATA", () => {
  const d = defaultDataDir("win32", { APPDATA: "C:\\Users\\me\\AppData\\Roaming" });
  assert.equal(d, join("C:\\Users\\me\\AppData\\Roaming", "cegueira"));
});

test("defaultDataDir：macOS 用 Application Support", () => {
  const d = defaultDataDir("darwin", { HOME: "/Users/me" });
  assert.equal(d, join("/Users/me", "Library", "Application Support", "cegueira"));
});

test("defaultDataDir：Linux 优先 XDG_DATA_HOME", () => {
  const d = defaultDataDir("linux", { HOME: "/home/me", XDG_DATA_HOME: "/data" });
  assert.equal(d, join("/data", "cegueira"));
});

test("defaultDataDir：Linux 无 XDG 回退 ~/.local/share", () => {
  const d = defaultDataDir("linux", { HOME: "/home/me" });
  assert.equal(d, join("/home/me", ".local", "share", "cegueira"));
});

test("resolveDataDir：自定义目录优先", () => {
  const d = resolveDataDir("E:/my-data", "win32", { APPDATA: "C:/x" });
  assert.equal(d, "E:/my-data");
});

test("resolveDataDir：空自定义回退默认", () => {
  const d = resolveDataDir("  ", "darwin", { HOME: "/Users/me" });
  assert.equal(d, join("/Users/me", "Library", "Application Support", "cegueira"));
});

test("formatBytes：分级格式化", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
});

test("createBackupManifest：清单字段", () => {
  const m = createBackupManifest("b1", ["a.json", "b.db"], 2048, "2026-10-02T00:00:00Z");
  assert.equal(m.id, "b1");
  assert.equal(m.files.length, 2);
  assert.equal(m.sizeBytes, 2048);
  assert.equal(m.createdAt, "2026-10-02T00:00:00Z");
});

test("manifestSummary：含体积与文件数", () => {
  const m = createBackupManifest("b1", ["a", "b", "c"], 2048);
  const s = manifestSummary(m);
  assert.ok(s.includes("b1"));
  assert.ok(s.includes("3 files"));
  assert.ok(s.includes("2.0 KB"));
});
