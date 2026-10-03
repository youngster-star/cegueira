/**
 * SQLite 存储：基于 Node 22 内置 `node:sqlite`（DatabaseSync），零第三方依赖。
 *
 * 表结构采用「id + data(JSON)」列，与 Repository 接口（CollectionStore<T>）天然匹配；
 * 规范化列查询（如按 project 查 scores）当前 MVP 数据量小，用 list + 过滤即可，
 * 后续需要时再演进为规范化表 + 索引。
 */
import { DatabaseSync } from "node:sqlite";
import type { CollectionStore } from "./store.js";
import type { ProfileRecord, ProjectRecord, ScoreRecord } from "./types.js";
import type { Persistence } from "./persistence.js";

const DDL = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scores   (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
`;

/** 打开（不存在则创建）数据库文件并建表。 */
export function createSqliteDatabase(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec(DDL);
  return db;
}

/** 基于 node:sqlite 的通用 JSON 列集合存储。表名由调用方硬编码，非用户输入。 */
export function createSqliteStore<T extends { id: string }>(
  db: DatabaseSync,
  table: string,
): CollectionStore<T> {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO ${table} (id, data) VALUES (?, ?)`,
  );
  const select = db.prepare(`SELECT data FROM ${table} WHERE id = ?`);
  const selectAll = db.prepare(`SELECT data FROM ${table}`);
  const remove = db.prepare(`DELETE FROM ${table} WHERE id = ?`);

  return {
    save(item) {
      insert.run(item.id, JSON.stringify(item));
    },
    get(id) {
      const row = select.get(id) as { data: string } | undefined;
      return row === undefined ? undefined : (JSON.parse(row.data) as T);
    },
    list() {
      return (selectAll.all() as { data: string }[]).map(
        (r) => JSON.parse(r.data) as T,
      );
    },
    delete(id) {
      return remove.run(id).changes > 0;
    },
  };
}

/** SQLite 持久化门面：持有连接，聚合三集合，可显式 close。 */
export interface SqlitePersistence extends Persistence {
  db: DatabaseSync;
  close(): void;
}

/** 基于 SQLite 文件的持久化（三张业务表）。 */
export function createSqlitePersistence(dbPath: string): SqlitePersistence {
  const db = createSqliteDatabase(dbPath);
  return {
    db,
    projects: createSqliteStore<ProjectRecord>(db, "projects"),
    scores: createSqliteStore<ScoreRecord>(db, "scores"),
    profiles: createSqliteStore<ProfileRecord>(db, "profiles"),
    close() {
      db.close();
    },
  };
}
