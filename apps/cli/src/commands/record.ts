/**
 * ceg record：跑一次用户 Agent 并落录制产物（P1/P2 录制路径的产品化入口）。
 *
 * ## 职责边界
 *
 * 真正的编排在 Python 侧（`python -m python.runtime.cli record`）——录制代理、
 * Agent 子进程、协议行读端都在 Python 域。本命令只负责：
 * 定位 Python 解释器 → 拼参数 → 拉起子进程 → 解析一行 JSON 摘要 → 渲染报告。
 *
 * 这条链路与桌面端 sidecar 走的是同一个 Python 入口，因此把它做成 CLI 命令
 * 等于提前验证了 sidecar 的调用契约。
 *
 * ## 为什么用 spawnSync 且可注入
 *
 * 同步是因为这是 CLI 的一次性动作，没必要引入异步状态机。可注入是为了单测
 * 能替换掉真实子进程——否则每个测试都要有可用的 Python + 本仓包，脆弱且慢。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Python 侧返回的一行 JSON 摘要。 */
export interface RecordSummary {
  run_id: string;
  run_dir: string;
  spans: number;
  tool_io: number;
  http: number;
  has_result: boolean;
  stdout_noise?: number;
}

export interface RecordOptions {
  agentDir: string;
  runDir: string;
  entry?: string;
  upstream?: string;
  /** 显式指定 Python 解释器；缺省自动探测。 */
  python?: string;
  /** 仓库根（`python` 包所在处）；缺省从本模块位置向上探测。 */
  repoRoot?: string;
  timeoutSec?: number;
}

/** 子进程执行结果（只需 spawnSync 用到的字段，便于注入替身）。 */
export interface SpawnResult {
  status: number | null;
  stdout?: string | null;
  stderr?: string | null;
  error?: Error;
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string; encoding: "utf-8" },
) => SpawnResult;

const defaultSpawn: SpawnFn = (command, args, options) =>
  spawnSync(command, args, options) as SpawnResult;

/**
 * 从本模块位置向上找仓库根（含 `python/runtime/cli.py` 的目录）。
 *
 * 不依赖 `process.cwd()`：用户可能在任意目录下敲 `ceg record`，
 * 而 Python 包必须能被 `-m python.runtime.cli` 找到。
 */
export function findRepoRoot(startDir: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "python", "runtime", "cli.py"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** 选择 Python 解释器：显式 > 仓库 .venv > PATH 上的 python/python3。 */
export function findPython(repoRoot: string, explicit?: string): string {
  if (explicit) return explicit;
  const venv =
    process.platform === "win32"
      ? join(repoRoot, ".venv", "Scripts", "python.exe")
      : join(repoRoot, ".venv", "bin", "python");
  if (existsSync(venv)) return venv;
  return process.platform === "win32" ? "python" : "python3";
}

/** 解析 Python 侧 stdout：取最后一行非空文本作为 JSON 摘要。 */
export function parseSummary(stdout: string): RecordSummary {
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new Error("录制子进程没有输出摘要");
  }
  const last = lines[lines.length - 1];
  try {
    return JSON.parse(last) as RecordSummary;
  } catch (e) {
    throw new Error(`录制摘要不是合法 JSON：${last}（${e instanceof Error ? e.message : e}）`);
  }
}

/** 录制：拉起 Python 录制器，返回人类可读报告。 */
export function recordCommand(opts: RecordOptions, spawn: SpawnFn = defaultSpawn): string {
  const repoRoot = opts.repoRoot ?? findRepoRoot();
  const python = findPython(repoRoot, opts.python);

  const args = [
    "-m",
    "python.runtime.cli",
    "record",
    "--agent",
    opts.agentDir,
    "--out",
    opts.runDir,
  ];
  if (opts.entry) args.push("--entry", opts.entry);
  if (opts.upstream) args.push("--upstream", opts.upstream);
  if (opts.timeoutSec !== undefined) args.push("--timeout", String(opts.timeoutSec));

  const res = spawn(python, args, { cwd: repoRoot, encoding: "utf-8" });
  if (res.error) {
    throw new Error(`无法启动录制子进程（${python}）：${res.error.message}`);
  }
  if (res.status !== 0) {
    const err = (res.stderr ?? "").trim();
    throw new Error(`录制失败（退出码 ${res.status}）：\n${err || "（无 stderr）"}`);
  }

  const s = parseSummary(res.stdout ?? "");
  const lines = [
    `✓ 录制完成：${s.run_dir}`,
    `run_id=${s.run_id}`,
    `span=${s.spans} tool_io=${s.tool_io} http=${s.http} 最终结果=${s.has_result ? "有" : "无"}`,
  ];
  if (s.stdout_noise) {
    lines.push(`⚠ stdout 有 ${s.stdout_noise} 行非协议内容（日志应写 stderr）`);
  }
  lines.push("下一步：ceg grade --contract <contract.json> --run " + s.run_dir);
  return lines.join("\n");
}
