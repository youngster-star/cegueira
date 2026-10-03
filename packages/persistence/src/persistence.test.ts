import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createJsonFilePersistence,
  createJsonFileStore,
  createMemoryPersistence,
  createMemoryStore,
  type ProjectRecord,
} from "./index.js";

const proj = (id: string, title: string): ProjectRecord => ({
  id,
  title,
  direction: "RAG 问答",
  contract: { stages: [] },
  createdAt: "2026-10-03T00:00:00Z",
  updatedAt: "2026-10-03T00:00:00Z",
});

test("MemoryStore：CRUD 完整", () => {
  const s = createMemoryStore<ProjectRecord>();
  s.save(proj("p1", "A"));
  assert.equal(s.get("p1")?.title, "A");
  assert.equal(s.list().length, 1);
  assert.equal(s.delete("p1"), true);
  assert.equal(s.get("p1"), undefined);
  assert.equal(s.delete("p1"), false);
});

test("MemoryStore：返回深拷贝，外部修改不污染内部", () => {
  const s = createMemoryStore<ProjectRecord>();
  s.save(proj("p1", "A"));
  const got = s.get("p1")!;
  got.title = "被篡改";
  assert.equal(s.get("p1")?.title, "A"); // 内部仍为 A
});

test("JsonFileStore：持久化跨实例保留", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ceg-persist-"));
  const file = path.join(dir, "projects.json");
  const a = createJsonFileStore<ProjectRecord>(file);
  a.save(proj("p1", "A"));

  // 新实例重新加载
  const b = createJsonFileStore<ProjectRecord>(file);
  assert.equal(b.get("p1")?.title, "A");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("JsonFileStore：原子写，不残留 .tmp 文件", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ceg-persist-"));
  const file = path.join(dir, "projects.json");
  const s = createJsonFileStore<ProjectRecord>(file);
  s.save(proj("p1", "A"));
  s.save(proj("p2", "B"));
  assert.ok(fs.existsSync(file));
  assert.ok(!fs.existsSync(`${file}.tmp`));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("JsonFileStore：损坏文件抛错而非静默重置", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ceg-persist-"));
  const file = path.join(dir, "projects.json");
  fs.writeFileSync(file, "{ not valid json", "utf-8");
  const s = createJsonFileStore<ProjectRecord>(file);
  assert.throws(() => s.list(), SyntaxError);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("MemoryPersistence：三集合独立", () => {
  const p = createMemoryPersistence();
  p.projects.save(proj("p1", "A"));
  p.scores.save({
    id: "s1",
    projectId: "p1",
    finalScore: 85.3,
    sCore: 0.8525,
    dimensions: { outcome: 0.9, process: 0.8, semantic: 0.85, rubric: 0.75 },
    gates: {},
    stats: {},
    createdAt: "2026-10-03T00:00:00Z",
  });
  p.profiles.save({
    id: "u1",
    skills: {},
    ladder: { l3Requests: 0, l4Requests: 0 },
    achievements: { lucidez: false },
    updatedAt: "2026-10-03T00:00:00Z",
  });
  assert.equal(p.projects.list().length, 1);
  assert.equal(p.scores.list().length, 1);
  assert.equal(p.profiles.list().length, 1);
});

test("JsonFilePersistence：三集合分别落盘到独立文件", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ceg-persist-"));
  const p = createJsonFilePersistence(dir);
  p.projects.save(proj("p1", "A"));
  assert.ok(fs.existsSync(path.join(dir, "projects.json")));
  assert.ok(!fs.existsSync(path.join(dir, "scores.json"))); // 未写 scores 则不创建
  fs.rmSync(dir, { recursive: true, force: true });
});
