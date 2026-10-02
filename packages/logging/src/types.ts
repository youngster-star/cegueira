/**
 * P5 分级日志（PRD §3 日志诊断）。
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export const LEVEL_ORDER: readonly LogLevel[] = ["debug", "info", "warn", "error"];

export interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  meta?: Record<string, unknown>;
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  /** 已记录的条目（副本，按写入序）。 */
  entries(): LogEntry[];
  setLevel(level: LogLevel): void;
}
