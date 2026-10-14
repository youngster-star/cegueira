/**
 * 桌面端 → 本地 sidecar 的真实引擎调用层。
 *
 * 之前桌面端的 Develop/Result 用的是硬编码演示分；现在改为调用本地 sidecar
 * （apps/sidecar），后者复用 CLI 引擎做真实录制与评分。浏览器预览与 Tauri
 * webview 走同一 HTTP 接口（sidecar 已开 CORS）。
 */
import type { ContractBundle } from "@cegueira/contract";

const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
export const API_BASE = env.VITE_SIDECAR ?? "http://127.0.0.1:8787";

/** 评分维度（与 scorer 的 DimensionScores 一致）。 */
export interface Dimensions {
  outcome: number;
  process: number;
  semantic: number;
  rubric: number;
}

/** 与 CLI gradeRun 的结构化输出对齐。 */
export interface GradeData {
  report: string;
  finalScore: number;
  sCore: number;
  dimensions: Dimensions;
  gates: {
    security: { passed: boolean; violations: string[] };
    outcome: { passed: boolean; min: number };
  };
  metrics?: {
    steps: number;
    toolChoiceAccuracy: number;
    successRate: number;
  };
  antiCheat?: { cheated: boolean; reasons: string[] };
}

export interface InitResult {
  dir: string;
  bundle: ContractBundle;
  degraded: boolean;
  attempts: number;
  paths: { contract: string; rubric: string; evalset: string };
}

export interface RecordResult {
  runDir: string;
  summary: {
    run_id?: string;
    cases?: number;
    ran_case_ids?: string[];
    failed_case_ids?: string[];
    spans?: number;
    tool_io?: number;
    http?: number;
    has_result?: boolean;
  };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(
      `无法连接本地引擎（${API_BASE}）：${(e as Error).message}\n请确认 sidecar 已启动（pnpm dev 会自动拉起）。`,
    );
  }
  const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!json.ok) throw new Error(json.error ?? "请求失败");
  return json.data as T;
}

export const backend = {
  health: () => fetch(`${API_BASE}/api/health`).then((r) => r.json()),
  /** 生成契约五件套（真实引擎），返回 bundle 与落盘路径。 */
  init: (direction: string) => post<InitResult>("/api/init", { direction }),
  /** 运行用户 Agent 并落录制产物（真实 Python 录制）。 */
  record: (args: { agentDir: string; evalsetPath?: string }) => post<RecordResult>("/api/record", args),
  /** 契约 + 录制 → 真实评分。 */
  grade: (args: {
    contractPath: string;
    runDir: string;
    evalsetPath?: string;
    sourcePath?: string;
    ladder?: { l3Requests: number; l4Requests: number; l4Explained: boolean };
  }) => post<GradeData>("/api/grade", args),
};
