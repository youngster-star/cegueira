import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";

import { defaultDataDir, resolveDataDir } from "./dataDir.js";
import { createBackupManifest, formatBytes, manifestSummary } from "./backup.js";

test("formatBytes：非有限数归零（回归）", () => {
  assert.equal(formatBytes(NaN), "0 B");
  assert.equal(formatBytes(Infinity), "0 B");
  assert.equal(formatBytes(-500), "0 B");
});

test("formatBytes：边界值", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1024 * 1024 - 1), "1024.0 KB");
  assert.equal(formatBytes(1024 * 1024), "1.0 MB");
  assert.equal(formatBytes(1024 * 1024 * 1024), "1024.0 MB");
});

test("defaultDataDir：win32 无 APPDATA 回退 LOCALAPPDATA", () => {
  const d = defaultDataDir("win32", { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" });
  assert.equal(d, join("C:\\Users\\me\\AppData\\Local", "cegueira"));
});

test("defaultDataDir：win32 完全无 env 回退 Public", () => {
  const d = defaultDataDir("win32", {});
  assert.equal(d, join("C:\\Users\\Public", "cegueira"));
});

test("defaultDataDir：darwin 无 HOME 回退 ~", () => {
  const d = defaultDataDir("darwin", {});
  assert.equal(d, join("~", "Library", "Application Support", "cegueira"));
});

test("defaultDataDir：linux 无 HOME/XDG 回退 ~/.local/share", () => {
  const d = defaultDataDir("linux", {});
  assert.equal(d, join("~", ".local", "share", "cegueira"));
});

test("resolveDataDir：自定义目录 trim 后生效", () => {
  const d = resolveDataDir("  E:/data  ", "win32", { APPDATA: "C:/x" });
  assert.equal(d, "E:/data");
});

test("defaultDataDir：自定义 appName", () => {
  const d = defaultDataDir("win32", { APPDATA: "C:/r" }, "my-app");
  assert.equal(d, join("C:/r", "my-app"));
});

test("createBackupManifest：files 深拷贝（外部修改不影响清单）", () => {
  const files = ["a.json"];
  const m = createBackupManifest("b", files, 10);
  files.push("b.db");
  assert.equal(m.files.length, 1, "清单 files 应为快照");
});

test("manifestSummary：单文件与 0 字节", () => {
  const m = createBackupManifest("b", ["a"], 0);
  const s = manifestSummary(m);
  assert.ok(s.includes("1 files"));
  assert.ok(s.includes("0 B"));
});
