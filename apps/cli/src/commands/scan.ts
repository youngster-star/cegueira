/**
 * ceg scan：L1 静态分析（PRD §4.1 / §4.8）。
 *
 * 把 `@cegueira/static-analysis` 的确定性规则扫描接到 CLI 上。此前 `scan()`
 * 有完整实现与单测，却**没有任何消费方**——是死代码。
 *
 * ## 定位：证据层，不进 FinalScore
 *
 * 按 PRD §4.1，L1 是三层证据里的「完全确定」层；但 §4.5 的公式里没有 L1 项。
 * 因此本命令只**如实报告**弱点计数与定位，不折算成分数、不参与门控。要影响
 * 最终判定，应由门控/advisory 层单独决策，不能偷偷塞进分数。
 *
 * ## 只扫 `*.py`
 *
 * 用户 Agent 目标语言仅 Python（PRD §10），扫描范围随之收窄；同时跳过
 * `node_modules` / `.venv` / `.git` 等明显无关的大目录，避免把依赖树当用户代码。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { scan, type Finding } from "@cegueira/static-analysis";

/** 找到的落点：文件路径 + 规则命中。 */
export interface ScanHit extends Finding {
  file: string;
}

const SKIP_DIRS = new Set(["node_modules", ".venv", ".git", "__pycache__", "dist"]);

/** 递归收集目录下的 .py 文件；传入文件则直接返回。 */
export function collectPythonFiles(path: string): string[] {
  const st = statSync(path);
  if (st.isFile()) return path.endsWith(".py") ? [path] : [];

  const out: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && SKIP_DIRS.has(entry.name)) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) out.push(...collectPythonFiles(child));
    else if (entry.isFile() && entry.name.endsWith(".py")) out.push(child);
  }
  // 排序保证输出确定（回放/对比要求确定性，任何依赖目录遍历顺序的写法都是隐患）
  return out.sort();
}

/** 扫描路径（文件或目录），返回全部命中与加权弱点计数。 */
export function scanPath(path: string): { hits: ScanHit[]; weaknessScore: number } {
  const hits: ScanHit[] = [];
  let weaknessScore = 0;
  for (const file of collectPythonFiles(path)) {
    const report = scan(readFileSync(file, "utf8"));
    weaknessScore += report.weaknessScore;
    for (const f of report.findings) hits.push({ file, ...f });
  }
  return { hits, weaknessScore };
}

/** 生成报告文本。 */
export function scanCommand(path: string): string {
  const { hits, weaknessScore } = scanPath(path);
  const counts = { high: 0, medium: 0, low: 0 };
  for (const h of hits) counts[h.severity]++;

  const lines = [
    `L1 静态分析：${path}`,
    `加权弱点计数：${weaknessScore.toFixed(2)}  [high=${counts.high} medium=${counts.medium} low=${counts.low} total=${hits.length}]`,
  ];

  if (hits.length === 0) {
    lines.push("未发现命中规则的弱点。");
    return lines.join("\n");
  }

  for (const h of hits) {
    lines.push(`  [${h.severity}] ${h.file}:${h.line} ${h.category} — ${h.message}`);
  }
  lines.push("说明：L1 为确定性证据层，不计入 FinalScore；是否据此拦截由门控单独决策。");
  return lines.join("\n");
}
