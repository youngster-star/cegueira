/**
 * 四道防作弊综合判定（P2 任务 3）。
 */
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
}

/** 综合四道防线，输出防作弊报告。 */
export function detectCheat(input: AntiCheatInput): AntiCheatReport {
  const { trace, runCaseIds, evalCases } = input;
  const reasons: string[] = [];

  // 防线 1：留出集完整性。
  const holdoutIds = evalCases.filter((c) => c.split === "holdout").map((c) => c.id);
  const holdout = checkHoldout(runCaseIds, holdoutIds);
  if (!holdout.intact) {
    reasons.push(`留出集缺失: ${holdout.missing.join(", ")}`);
  }

  // 防线 2：改写/硬编码（答案与题目字面重叠过高）。
  const rewriteReasons: string[] = [];
  let rewriteSuspicious = false;
  const finalText = trace.finalAnswer?.text ?? "";
  for (const c of evalCases) {
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
  const allAssertions = evalCases.flatMap((c) => c.dataFlowAssertions);
  const dataFlowViolations = checkDataFlow(trace, allAssertions);
  if (dataFlowViolations.length > 0) {
    reasons.push(`数据流断言违规 ${dataFlowViolations.length} 项`);
  }

  // 防线 4：语料扰动。
  const noiseDocIds = evalCases.flatMap((c) => c.noiseDocIds ?? []);
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
