/**
 * CLI 统一文件读取。
 *
 * Windows 记事本 / PowerShell `Set-Content -Encoding UTF8` 会在文件开头写入
 * UTF-8 BOM（U+FEFF）。`JSON.parse` / YAML 解析器遇到 BOM 会直接报
 * 「Unexpected token」，用户看到的是无头绪的解析错误。这里在读入时统一剥掉
 * 前导 BOM，让「我手改的 contract.json 为什么读不了」不再发生。
 */
import { readFileSync } from "node:fs";

/** 读取 UTF-8 文本并去掉前导 BOM（若有）。 */
export function readText(path: string): string {
  const s = readFileSync(path, "utf8");
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** 读取并解析 JSON，容忍前导 BOM。 */
export function readJson<T>(path: string): T {
  return JSON.parse(readText(path)) as T;
}
