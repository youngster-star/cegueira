/**
 * ceg init：生成契约五件套（PRD §6.1 / P1 任务 6）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  contractToJson,
  evalsetToJson,
  generateWithSelfCheck,
  projectMdToMarkdown,
  rubricToYaml,
  type ContractBundle,
} from "@cegueira/contract";

/** 契约输出目录名。 */
export const CONTRACT_DIR = "cegueira-contract";

/** 生成契约五件套对象（含自检/降级信息），供 CLI 与 sidecar 复用。 */
export function initBundle(direction: string): {
  bundle: ContractBundle;
  attempts: number;
  degraded: boolean;
} {
  return generateWithSelfCheck({ direction });
}

/** 把五件套写入目录（文件名与 grade/verify 约定一致）。 */
export function writeBundle(bundle: ContractBundle, outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "project.md"), projectMdToMarkdown(bundle.projectMd));
  writeFileSync(join(outDir, "contract.json"), contractToJson(bundle.contract));
  writeFileSync(join(outDir, "rubric.yaml"), rubricToYaml(bundle.rubric));
  writeFileSync(join(outDir, "checks.json"), JSON.stringify(bundle.checks, null, 2));
  writeFileSync(join(outDir, "evalset.json"), evalsetToJson(bundle.evalset));
}

/** 初始化契约：方向 → 五件套落盘。返回输出目录。 */
export function initCommand(direction: string, outDir = CONTRACT_DIR): string {
  const { bundle, attempts, degraded } = initBundle(direction);
  writeBundle(bundle, outDir);
  if (degraded) {
    console.warn(`⚠ 契约自检未通过，已降级（重生成 ${attempts} 次）`);
  }
  return outDir;
}
