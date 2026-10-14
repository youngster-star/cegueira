/**
 * Cegueira 本地 sidecar：把真实引擎（生成契约 / 录制 / 评分）暴露为本地 HTTP，
 * 供桌面端（浏览器预览与 Tauri webview）调用。零第三方依赖。
 *
 * 引擎复用 CLI 的编译产物（apps/cli/dist），保证「桌面端所见」与 `ceg` 命令一致。
 * 录制需要 Python，故通过子进程调 `python -m python.runtime.cli record`。
 *
 * 端点（POST，JSON）：
 *   /api/init    {direction, out?}                                  → {dir, bundle, paths}
 *   /api/record  {agentDir, out?, evalsetPath?, entry?, mockMode?}  → {runDir, summary}
 *   /api/grade   {contractPath, runDir, evalsetPath?, ladder?, ...} → GradeOutcome
 *   /api/health  GET                                                → {ok, repoRoot, python}
 */
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

import { writeBundle } from "../cli/dist/commands/init.js";
import { gradeRun } from "../cli/dist/commands/grade.js";
import { generateBundle, generateBundleWithLlm } from "../../packages/contract/dist/index.js";
import {
  createOllamaProvider,
  createOpenAIProvider,
  createAnthropicProvider,
} from "../../packages/llm/dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const PORT = Number(process.env.CEG_SIDECAR_PORT ?? 8787);

/** 与 CLI 的 findPython 一致：优先仓库 .venv，否则 PATH。 */
function pythonExe() {
  const v =
    process.platform === "win32"
      ? join(REPO_ROOT, ".venv", "Scripts", "python.exe")
      : join(REPO_ROOT, ".venv", "bin", "python");
  if (existsSync(v)) return v;
  return process.platform === "win32" ? "python" : "python3";
}

function workspaceDir(sub) {
  const d = join(tmpdir(), "ceg-desktop", sub);
  mkdirSync(d, { recursive: true });
  return d;
}

/** 由前端传入的连接配置构造 LLM provider；不完整/未知则返回 null（走模板）。 */
function buildProvider(cfg) {
  if (!cfg || typeof cfg !== "object" || !cfg.provider) return null;
  const c = {
    baseUrl: cfg.baseUrl || undefined,
    model: cfg.model || undefined,
    apiKey: cfg.apiKey || undefined,
  };
  switch (cfg.provider) {
    case "ollama":
      return createOllamaProvider(c);
    case "openai":
      return createOpenAIProvider(c);
    case "anthropic":
      return createAnthropicProvider(c);
    default:
      return null;
  }
}

/**
 * 生成契约：优先用 LLM 按「方向 + 主题 + 难度」定制（PRD §6.1），失败或未配置则降级模板。
 * 返回还有 source/degraded 便于前端如实展示。
 */
async function handleInit(body) {
  const direction = String(body.direction ?? "").trim() || "RAG 问答 Agent";
  const input = {
    direction,
    topic: body.topic ? String(body.topic).trim() : undefined,
    difficulty: typeof body.difficulty === "number" ? body.difficulty : undefined,
    selfAssessment: body.selfAssessment !== undefined ? String(body.selfAssessment) : undefined,
  };
  const dir = body.out
    ? resolve(String(body.out))
    : join(workspaceDir("contracts"), randomUUID());

  let bundle;
  let source = "template";
  let degraded = true;
  const provider = buildProvider(body.llm);
  if (provider) {
    try {
      bundle = await generateBundleWithLlm(provider, input);
      // 与模板比对 stages：相同说明 LLM 实际失败并降级了。
      const tmpl = generateBundle(input);
      const fellBack =
        JSON.stringify(bundle.contract.stages) === JSON.stringify(tmpl.contract.stages);
      source = fellBack ? "template (LLM 失败降级)" : "llm";
      degraded = fellBack;
    } catch {
      bundle = undefined;
    }
  }
  if (!bundle) {
    // 模板路径：同样应用 topic/difficulty（标题取 topic，难度进 PRD 描述）。
    bundle = generateBundle(input);
    source = "template";
    degraded = true;
  }

  writeBundle(bundle, dir);
  return {
    dir,
    bundle,
    degraded,
    source,
    paths: {
      contract: join(dir, "contract.json"),
      rubric: join(dir, "rubric.yaml"),
      evalset: join(dir, "evalset.json"),
    },
  };
}

function handleRecord(body) {
  const agentDir = body.agentDir ? resolve(String(body.agentDir)) : null;
  if (!agentDir) throw new Error("record 需要 agentDir");
  if (!existsSync(agentDir)) throw new Error(`Agent 目录不存在：${agentDir}`);
  const out = body.out
    ? resolve(String(body.out))
    : join(workspaceDir("runs"), randomUUID());

  const args = ["-m", "python.runtime.cli", "record", "--agent", agentDir, "--out", out];
  if (body.entry) args.push("--entry", String(body.entry));
  if (body.evalsetPath) args.push("--evalset", resolve(String(body.evalsetPath)));
  if (body.mockMode) args.push("--mock-mode", String(body.mockMode));
  if (body.depsDir) args.push("--deps-dir", resolve(String(body.depsDir)));
  args.push("--timeout", body.timeoutSec ? String(body.timeoutSec) : "180");

  const res = spawnSync(pythonExe(), args, {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw new Error(`无法启动录制子进程：${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(`录制失败：\n${(res.stderr || "").trim() || "（无 stderr）"}`);
  }
  const last = (res.stdout || "").trim().split("\n").filter(Boolean).pop() || "{}";
  let summary;
  try {
    summary = JSON.parse(last);
  } catch {
    throw new Error(`录制摘要不是合法 JSON：${last}`);
  }
  return { runDir: out, summary };
}

function handleGrade(body) {
  if (!body.contractPath) throw new Error("grade 需要 contractPath");
  if (!body.runDir) throw new Error("grade 需要 runDir");
  return gradeRun({
    contractPath: resolve(String(body.contractPath)),
    runDir: resolve(String(body.runDir)),
    evalsetPath: body.evalsetPath ? resolve(String(body.evalsetPath)) : undefined,
    systemPrompt: body.systemPrompt ? String(body.systemPrompt) : undefined,
    sourcePath: body.sourcePath ? resolve(String(body.sourcePath)) : undefined,
    storeDir: body.storeDir ? resolve(String(body.storeDir)) : undefined,
    ranCases: Array.isArray(body.ranCases) ? body.ranCases : undefined,
    ladder: body.ladder ?? undefined,
  });
}

const ROUTES = { "/api/init": handleInit, "/api/record": handleRecord, "/api/grade": handleGrade };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function send(res, status, payload) {
  res.writeHead(status, { ...CORS, "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/health") {
    send(res, 200, {
      ok: true,
      data: { repoRoot: REPO_ROOT, python: pythonExe(), hasVenv: existsSync(join(REPO_ROOT, ".venv")) },
    });
    return;
  }
  const handler = ROUTES[url.pathname];
  if (!handler) {
    send(res, 404, { ok: false, error: `未知端点 ${url.pathname}` });
    return;
  }
  let raw = "";
  req.on("data", (c) => {
    raw += c;
  });
  req.on("end", async () => {
    try {
      const body = raw ? JSON.parse(raw) : {};
      const data = await handler(body);
      send(res, 200, { ok: true, data });
    } catch (e) {
      send(res, 400, { ok: false, error: String(e?.message ?? e) });
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[sidecar] http://127.0.0.1:${PORT}  repo=${REPO_ROOT}`);
});
