/**
 * SQLite 业务库 schema。
 * 由 Node sidecar 独占读写，Rust 层不直接读写（见 docs/开发文档.md §5.2）。
 * 业务表（projects / scores / profiles）的权威 DDL 已落地于
 * packages/persistence/src/sqlite.ts；此处保留版本号与 meta 表定义。
 */
export const SCHEMA_VERSION = 1;

export const SQL_SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
