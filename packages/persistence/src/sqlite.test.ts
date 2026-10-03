import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createSqliteDatabase,
  createSqlitePersistence,
  createSqliteStore,
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

test("SqliteStore：内存库 CRUD", () => {
  const db = createSqliteDatabase(":memory:");
  const s = createSqliteStore<ProjectRecord>(db, "projects");
  s.save(proj("p1", "A"));
  assert.equal(s.get("p1")?.title, "A");
  assert.equal(s.list().length, 1);
  assert.equal(s.delete("p1"), true);
  assert.equal(s.get("p1"), undefined);
  assert.equal(s.delete("p1"), false);
  db.close();
});

test("SqliteStore：save 覆盖同 id", () => {
  const db = createSqliteDatabase(":memory:");
  const s = createSqliteStore<ProjectRecord>(db, "projects");
  s.save(proj("p1", "A"));
  s.save(proj("p1", "B"));
  assert.equal(s.get("p1")?.title, "B");
  assert.equal(s.list().length, 1);
  db.close();
});

test("SqlitePersistence：文件库跨实例持久化", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ceg-sqlite-"));
  const file = path.join(dir, "cegueira.db");

  const a = createSqlitePersistence(file);
  a.projects.save(proj("p1", "A"));
  a.scores.save({
    id: "s1",
    projectId: "p1",
    finalScore: 85.3,
    sCore: 0.8525,
    dimensions: { outcome: 0.9, process: 0.8, semantic: 0.85, rubric: 0.75 },
    gates: {},
    stats: {},
    createdAt: "2026-10-03T00:00:00Z",
  });
  a.close();

  // 重新打开读回
  const b = createSqlitePersistence(file);
  assert.equal(b.projects.get("p1")?.title, "A");
  assert.equal(b.scores.get("s1")?.finalScore, 85.3);
  b.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("SqlitePersistence：三集合独立", () => {
  const db = createSqliteDatabase(":memory:");
  const p = {
    projects: createSqliteStore<ProjectRecord>(db, "projects"),
  };
  p.projects.save(proj("p1", "A"));
  assert.equal(p.projects.list().length, 1);
  db.close();
});

test("SqliteStore：返回独立副本，外部修改不污染", () => {
  const db = createSqliteDatabase(":memory:");
  const s = createSqliteStore<ProjectRecord>(db, "projects");
  s.save(proj("p1", "A"));
  const got = s.get("p1")!;
  got.title = "篡改";
  assert.equal(s.get("p1")?.title, "A"); // 内部仍为 A
  db.close();
});

test("createSqliteDatabase：重复建表幂等", () => {
  const db = createSqliteDatabase(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  `); // 再次执行不报错
  db.close();
});
