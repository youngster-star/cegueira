/**
 * 四道防作弊综合判定（P2 任务 3）。
 */
export * from "./types.js";
export * from "./rewrite.js";
export * from "./holdout.js";
export * from "./dataflow.js";
export * from "./perturb.js";
import type { AgentTrace } from "@cegueira/trace";
import type { AntiCheatReport, EvalCase } from "./types.js";
import { checkHoldout } from "./holdout.js";
import { detectHardcoded, overlapRatio } from "./rewrite.js";
import { checkDataFlow } from "./dataflow.js";
import { checkPerturbation } from "./perturb.js";

export interface AntiCheatInput {
  trace: AgentTrace;
  /** 评分实际运行的 case id 列表。 */
  runCaseIds: string[];
  evalCases: EvalCase[];
  /**
   * 该轨迹对应的 case id。
   *
   * 给出时：防线 2/3/4（改写、数据流、扰动）**只针对该 case 的 EvalCase**，
   * 避免把别的 case 的题目/断言/噪声文档错配到这条轨迹上（逐 case 录制下
   * 多条轨迹各有其题，跨 case 比对会误判）。
   *
   * 防线 1（留出集完整性）仍用**全量** evalCases——它判的是「哪些 case 跑了」，
   * 是运行级事实，不能按轨迹切片。
   */
  traceCaseId?: string;
}

/** 综合四道防线，输出防作弊报告。 */
export function detectCheat(input: AntiCheatInput): AntiCheatReport {
  const { trace, runCaseIds, evalCases, traceCaseId } = input;
  const reasons: string[] = [];

  // 防线 1：留出集完整性（运行级，始终用全量 evalCases）。
  const holdoutIds = evalCases.filter((c) => c.split === "holdout").map((c) => c.id);
  const holdout = checkHoldout(runCaseIds, holdoutIds);
  if (!holdout.intact) {
    reasons.push(`留出集缺失: ${holdout.missing.join(", ")}`);
  }

  // 轨迹级检查的 case 集合：给了 traceCaseId 就只取该 case，否则退回全量。
  const traceCases =
    traceCaseId === undefined ? evalCases : evalCases.filter((c) => c.id === traceCaseId);

  // 防线 2：改写/硬编码（答案与题目字面重叠过高）。
  const rewriteReasons: string[] = [];
  let rewriteSuspicious = false;
  const finalText = trace.finalAnswer?.text ?? "";
  for (const c of traceCases) {
    if (finalText && detectHardcoded(c.prompt, finalText)) {
      rewriteSuspicious = true;
      rewriteReasons.push(
        `答案疑似复制题目 "${c.id}"（重叠度 ${overlapRatio(c.prompt, finalText).toFixed(2)}）`,
      );
    }
  }
  if (rewriteSuspicious) {
    reasons.push("答案与题目字面重叠过高，疑似硬编码");
  }

  // 防线 3：数据流断言。
  const allAssertions = traceCases.flatMap((c) => c.dataFlowAssertions);
  const dataFlowViolations = checkDataFlow(trace, allAssertions);
  if (dataFlowViolations.length > 0) {
    reasons.push(`数据流断言违规 ${dataFlowViolations.length} 项`);
  }

  // 防线 4：语料扰动。
  const noiseDocIds = traceCases.flatMap((c) => c.noiseDocIds ?? []);
  const perturbation = checkPerturbation(trace.finalAnswer, noiseDocIds);
  if (!perturbation.resistant) {
    reasons.push(`引用噪声文档: ${perturbation.leaks.join(", ")}`);
  }

  return {
    holdoutIntact: holdout.intact,
    holdoutMissing: holdout.missing,
    rewriteSuspicious,
    rewriteReasons,
    dataFlowViolations,
    perturbationResistant: perturbation.resistant,
    perturbationLeaks: perturbation.leaks,
    cheated: reasons.length > 0,
    reasons,
  };
}

/** 合并多份防作弊报告（逐 case 评估后聚合；任一 case 作弊即整体作弊）。 */
export function mergeAntiCheat(reports: AntiCheatReport[]): AntiCheatReport {
  if (reports.length === 0) {
    return {
      holdoutIntact: true,
      holdoutMissing: [],
      rewriteSuspicious: false,
      rewriteReasons: [],
      dataFlowViolations: [],
      perturbationResistant: true,
      perturbationLeaks: [],
      cheated: false,
      reasons: [],
    };
  }
  const uniq = (xs: string[]): string[] => [...new Set(xs)];
  return {
    holdoutIntact: reports.every((r) => r.holdoutIntact),
    holdoutMissing: uniq(reports.flatMap((r) => r.holdoutMissing)),
    rewriteSuspicious: reports.some((r) => r.rewriteSuspicious),
    rewriteReasons: uniq(reports.flatMap((r) => r.rewriteReasons)),
    dataFlowViolations: uniq(reports.flatMap((r) => r.dataFlowViolations)),
    perturbationResistant: reports.every((r) => r.perturbationResistant),
    perturbationLeaks: uniq(reports.flatMap((r) => r.perturbationLeaks)),
    cheated: reports.some((r) => r.cheated),
    reasons: uniq(reports.flatMap((r) => r.reasons)),
  };
}
