/**
 * 内存日志器：按级别过滤，结构化条目。
 */
import { LEVEL_ORDER, type LogEntry, type Logger, type LogLevel } from "./types.js";

export function createLogger(minLevel: LogLevel = "info"): Logger {
  const entries: LogEntry[] = [];
  let currentLevel: LogLevel = minLevel;

  function log(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    if (LEVEL_ORDER.indexOf(level) < LEVEL_ORDER.indexOf(currentLevel)) return;
    entries.push({ ts: new Date().toISOString(), level, msg, meta });
  }

  return {
    debug: (m, meta) => log("debug", m, meta),
    info: (m, meta) => log("info", m, meta),
    warn: (m, meta) => log("warn", m, meta),
    error: (m, meta) => log("error", m, meta),
    entries: () => [...entries],
    setLevel(level) {
      currentLevel = level;
    },
  };
}

/** 格式化一条日志为单行文本。 */
export function formatEntry(e: LogEntry): string {
  const meta = e.meta ? ` ${JSON.stringify(e.meta)}` : "";
  return `${e.ts} [${e.level.toUpperCase()}] ${e.msg}${meta}`;
}
