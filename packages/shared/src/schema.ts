/**
 * SQLite 业务库 schema 占位。
 * 由 Node sidecar 独占读写，Rust 层不直接读写（见 docs/开发文档.md §5.2）。
 * P1 实现评分/画像后在此填充 projects / scores / profiles 等表。
 */
export const SCHEMA_VERSION = 1;

export const SQL_SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
