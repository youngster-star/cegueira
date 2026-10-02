/**
 * 跨平台默认数据目录解析（platform / env 可注入以便测试）。
 */
import { join } from "node:path";

import type { EnvLike, Platform } from "./types.js";

export const DEFAULT_APP_NAME = "cegueira";

export function defaultDataDir(
  platform: Platform,
  env: EnvLike,
  appName = DEFAULT_APP_NAME,
): string {
  if (platform === "win32") {
    const base = env.APPDATA || env.LOCALAPPDATA || "C:\\Users\\Public";
    return join(base, appName);
  }
  if (platform === "darwin") {
    return join(env.HOME || "~", "Library", "Application Support", appName);
  }
  // linux：XDG_DATA_HOME 优先
  const xdg = env.XDG_DATA_HOME || join(env.HOME || "~", ".local", "share");
  return join(xdg, appName);
}

/** 数据目录解析：用户显式指定则优先，否则用平台默认（PRD §3 数据存储位置可配）。 */
export function resolveDataDir(
  custom: string | undefined,
  platform: Platform,
  env: EnvLike,
  appName = DEFAULT_APP_NAME,
): string {
  if (custom && custom.trim()) return custom.trim();
  return defaultDataDir(platform, env, appName);
}

/** 从 Node 运行时读取的便捷入口。 */
export function defaultDataDirAuto(
  env: EnvLike = process.env,
  appName = DEFAULT_APP_NAME,
): string {
  return defaultDataDir(process.platform as Platform, env, appName);
}
