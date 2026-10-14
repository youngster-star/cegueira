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

/** 从 `python --version` 输出解析主次版本号（如 "Python 3.13.14" → [3,13]）。 */
export function parsePythonVersion(out: string | null): [number, number] | null {
  if (out === null) return null;
  const m = out.match(/(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** 版本是否满足 Python ≥3.11（录制器与运行时要求）。 */
export function pythonVersionOk(v: [number, number] | null): boolean {
  return v !== null && (v[0] > 3 || (v[0] === 3 && v[1] >= 11));
}

/** 脱敏代理地址（隐藏 `user:pass@` 部分）。 */
export function maskProxy(url: string): string {
  const at = url.indexOf("@");
  return at >= 0 ? `***@${url.slice(at + 1)}` : url;
}

/**
 * 校验代理 URL 格式：仅接受 http/https、含主机名。返回错误说明或 null（合法）。
 * 只做格式校验——Node 的 fetch 默认不走 HTTP_PROXY，真正连通性验证需代理 agent，
 * 不在自检范围内（如实报告配置本身是否可用）。
 */
export function validateProxy(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "不是合法 URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `协议应为 http/https，实际 ${parsed.protocol}`;
  }
  if (!parsed.hostname) return "缺少主机名";
  return null;
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

  // 与 record 的 findPython 一致：优先用仓库 .venv（录制实际所用），否则退回 PATH。
  const venvPy =
    process.platform === "win32"
      ? join(cwd, ".venv", "Scripts", "python.exe")
      : join(cwd, ".venv", "bin", "python");
  const useVenv = existsSync(venvPy);
  const py = useVenv
    ? runVersion(`"${venvPy}" --version`)
    : runVersion("python --version") ?? runVersion("python3 --version");
  const pyVer = parsePythonVersion(py);
  const pyOk = pythonVersionOk(pyVer);
  items.push({
    name: "python",
    ok: pyOk,
    detail:
      py === null
        ? `未找到 python（来源：${useVenv ? "仓库 .venv" : "PATH"}；需 ≥3.11）`
        : `${py}（来源：${useVenv ? "仓库 .venv" : "PATH"}${pyOk ? "" : "，需 ≥3.11"}）`,
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
    const entries: [string, string][] = [];
    if (proxy.http) entries.push(["HTTP", proxy.http]);
    if (proxy.https) entries.push(["HTTPS", proxy.https]);
    if (proxy.all) entries.push(["ALL", proxy.all]);
    const problems = entries
      .map(([name, url]) => {
        const err = validateProxy(url);
        return err ? `${name}(${err})` : null;
      })
      .filter(Boolean) as string[];
    const parts = entries.map(([name, url]) => `${name}=${maskProxy(url)}`);
    items.push({
      name: "proxy",
      ok: problems.length === 0,
      detail:
        parts.join(" ") + (problems.length > 0 ? `  ⚠ 非法：${problems.join("；")}` : ""),
    });
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
