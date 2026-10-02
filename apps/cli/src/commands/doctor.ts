/**
 * ceg doctor：环境自检（PRD §3 / 开发文档 §3）。
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** 单项检查结果。 */
interface CheckItem {
  name: string;
  ok: boolean;
  detail: string;
}

function runVersion(cmd: string): string | null {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

/** 自检：检查 node / python / .venv，返回检查结果文本。 */
export function doctorCommand(cwd = process.cwd()): string {
  const items: CheckItem[] = [];

  items.push({
    name: "node",
    ok: true,
    detail: process.version,
  });

  const py = runVersion("python --version") ?? runVersion("python3 --version");
  items.push({
    name: "python",
    ok: py !== null,
    detail: py ?? "未找到 python",
  });

  const venv = existsSync(join(cwd, ".venv"));
  items.push({
    name: "venv",
    ok: venv,
    detail: venv ? ".venv 存在" : ".venv 不存在（首次运行 ceg 会自动创建）",
  });

  const lines = items.map((i) => `[${i.ok ? "✓" : "✗"}] ${i.name}: ${i.detail}`);
  const allOk = items.every((i) => i.ok);
  lines.push(allOk ? "环境就绪" : "存在缺失项，请参照 docs/环境配置.md 补齐");
  return lines.join("\n");
}
