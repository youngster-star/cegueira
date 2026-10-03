/**
 * ceg doctor：环境自检（PRD §3 / 开发文档 §3）。
 * 检查 node / python / rust / venv / 代理（国内用户刚需）。
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

/** 脱敏代理地址（隐藏 `user:pass@` 部分）。 */
export function maskProxy(url: string): string {
  const at = url.indexOf("@");
  return at >= 0 ? `***@${url.slice(at + 1)}` : url;
}

/** 代理检测结果。 */
export interface ProxyInfo {
  detected: boolean;
  http: string | null;
  https: string | null;
  all: string | null;
}

/** 从环境变量检测代理配置（跨平台，大小写不敏感）。 */
export function detectProxy(env: NodeJS.ProcessEnv): ProxyInfo {
  const http = env.HTTP_PROXY ?? env.http_proxy ?? null;
  const https = env.HTTPS_PROXY ?? env.https_proxy ?? null;
  const all = env.ALL_PROXY ?? env.all_proxy ?? null;
  return { detected: !!(http || https || all), http, https, all };
}

/** 自检：检查 node / python / rust / venv / 代理，返回检查结果文本。 */
export function doctorCommand(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const items: CheckItem[] = [];

  items.push({ name: "node", ok: true, detail: process.version });

  const py = runVersion("python --version") ?? runVersion("python3 --version");
  items.push({
    name: "python",
    ok: py !== null,
    detail: py ?? "未找到 python",
  });

  const rust = runVersion("rustc --version");
  items.push({
    name: "rust",
    ok: rust !== null,
    detail:
      rust ??
      "未找到 rustc（桌面壳需要；确认 PATH 含 rust 安装目录的 bin，如 E:/rust/.cargo/bin）",
  });

  const venv = existsSync(join(cwd, ".venv"));
  items.push({
    name: "venv",
    ok: venv,
    detail: venv ? ".venv 存在" : ".venv 不存在（首次运行 ceg 会自动创建）",
  });

  const proxy = detectProxy(env);
  if (proxy.detected) {
    const parts = [
      proxy.http && `HTTP=${maskProxy(proxy.http)}`,
      proxy.https && `HTTPS=${maskProxy(proxy.https)}`,
      proxy.all && `ALL=${maskProxy(proxy.all)}`,
    ].filter(Boolean) as string[];
    items.push({ name: "proxy", ok: true, detail: parts.join(" ") });
  } else {
    items.push({
      name: "proxy",
      ok: true,
      detail: "未配置（直连网络可忽略；国内网络访问 GitHub/LLM API 建议配置）",
    });
  }

  const lines = items.map((i) => `[${i.ok ? "✓" : "✗"}] ${i.name}: ${i.detail}`);
  const allOk = items.every((i) => i.ok);
  lines.push(allOk ? "环境就绪" : "存在缺失项，请参照 docs/环境配置.md 补齐");
  return lines.join("\n");
}
