/**
 * 契约验收 → S_outcome 桥接（A1 接线）。
 *
 * ## 补齐的缺口
 *
 * `@cegueira/trace` 已经能把一条任务的多条 acceptance 对着轨迹逐条求值
 * （`evaluateTaskAcceptance`），但**没有任何代码把它与评分引擎接起来**——
 * `ScoreInput.outcomeSamples` 一直是手工喂进去的。本模块把「契约 + 轨迹」
 * 变成 S_outcome 的采样值，使 S_outcome 可由一次真实录制算出。
 *
 * ## 聚合口径
 *
 * - 阶段内：任务通过率按 `task.weight` 加权。契约约定同一阶段内 weight 之和
 *   为 1（contract/validate.ts 已校验），这里仍做一次归一化以防手改契约。
 * - 阶段间：契约**没有**阶段权重，故等权平均。
 *
 * 权重缺失（全为 0）时退化为等权，而不是除零。
 *
 * ## 为什么直接复用 trace 的求值器
 *
 * 验收断言的语义（不可求值 vs 未通过、集合运算、类型检查）只在 trace 里实现了
 * 一份。这里绝不重写——重写就是「两种真相」，与 load.ts / manifest.py 的往返
 * 断言要防的是同一类问题。
 */
import type { Contract } from "@cegueira/contract";
import {
  computeMetrics,
  evaluateTaskAcceptance,
  factsOf,
  type AgentTrace,
  type EfficiencyMetrics,
  type TaskAcceptanceResult,
} from "@cegueira/trace";
import { score } from "./score.js";
import { sProcess, sSemantic } from "./process.js";
import type { ScoreResult, SecurityChecks } from "./types.js";

/** 单个任务的验收结果（带契约坐标，便于报告回指）。 */
export interface TaskAcceptanceOutcome {
  stageId: string;
  stageName: string;
  taskId: string;
  taskName: string;
  /** 契约里该任务在阶段内的权重。 */
  weight: number;
  result: TaskAcceptanceResult;
}

/** 一次轨迹下的验收总体结果。 */
export interface OutcomeEvaluation {
  /** 加权通过率，0–1。 */
  rate: number;
  /** 各阶段通过率（等权前的中间结果，保序）。 */
  stages: { id: string; name: string; rate: number }[];
  /** 逐任务明细，保序。 */
  tasks: TaskAcceptanceOutcome[];
}

/** 阶段内任务按 weight 加权。全为 0 时退化等权。 */
function weightedRate(scores: number[], weights: number[]): number {
  const total = weights.reduce((a, w) => a + w, 0);
  if (total <= 0) {
    return scores.reduce((a, s) => a + s, 0) / Math.max(1, scores.length);
  }
  let acc = 0;
  for (let i = 0; i < scores.length; i++) acc += (weights[i] / total) * scores[i];
  return acc;
}

/**
 * 对一条轨迹求全部任务的验收通过率，并聚合成 S_outcome 的采样值（0–1）。
 *
 * @throws 任一任务的断言**一条都不可求值**时抛出（由 evaluateTaskAcceptance
 *   抛出）——那属于契约缺陷，不能静默算成 Agent 的 0 分（见 trace/acceptance.ts）。
 */
export function evaluateOutcome(
  contract: Contract,
  trace: AgentTrace,
  metrics: EfficiencyMetrics = computeMetrics(trace),
): OutcomeEvaluation {
  if (contract.stages.length === 0) {
    throw new RangeError("契约没有任何阶段，无法求 S_outcome");
  }

  const facts = factsOf(trace, metrics);
  const tasks: TaskAcceptanceOutcome[] = [];
  const stages: { id: string; name: string; rate: number }[] = [];

  for (const stage of contract.stages) {
    const stageRates: number[] = [];
    const stageWeights: number[] = [];
    for (const task of stage.tasks) {
      const result = evaluateTaskAcceptance(task.acceptance, trace, facts, metrics);
      tasks.push({
        stageId: stage.id,
        stageName: stage.name,
        taskId: task.id,
        taskName: task.name,
        weight: task.weight,
        result,
      });
      stageRates.push(result.rate);
      stageWeights.push(task.weight);
    }
    stages.push({
      id: stage.id,
      name: stage.name,
      rate: weightedRate(stageRates, stageWeights),
    });
  }

  const rate =
    stages.reduce((a, s) => a + s.rate, 0) / stages.length;
  return { rate, stages, tasks };
}

/** 便捷入口：只要 S_outcome 的标量值。 */
export function outcomeFromTrace(
  contract: Contract,
  trace: AgentTrace,
  metrics?: EfficiencyMetrics,
): number {
  return evaluateOutcome(contract, trace, metrics).rate;
}

/** scoreFromTrace 的可选项。 */
export interface ScoreFromTraceOptions {
  /** 安全三断言结果（Gate_security 的唯一输入，无默认值——不可省略）。 */
  security: SecurityChecks;
  /** 覆盖 S_semantic；缺省按轨迹检索命中率（无检索=1.0）。 */
  semantic?: number;
  /** S_rubric 采样；缺省交给 scorer 的占位。 */
  rubricSamples?: number[];
  /** 惩罚项。 */
  penalty?: number;
}

/** 由轨迹算出的完整评分（含中间信号，便于报告）。 */
export interface TraceScore {
  result: ScoreResult;
  outcome: OutcomeEvaluation;
  metrics: EfficiencyMetrics;
}

/**
 * 契约 + 轨迹 → 完整评分。
 *
 * 一次确定性回放只产生一个 outcome 采样，故 `outcomeSamples = [rate]`（min 即它本身）。
 * 多次真实采样测稳定性是另一条独立链路（PRD §4.2），不在本函数职责内。
 */
export function scoreFromTrace(
  contract: Contract,
  trace: AgentTrace,
  options: ScoreFromTraceOptions,
): TraceScore {
  const metrics = computeMetrics(trace);
  const outcome = evaluateOutcome(contract, trace, metrics);

  const result = score({
    outcomeSamples: [outcome.rate],
    process: sProcess(metrics),
    semantic: options.semantic ?? sSemantic(metrics.retrievalHitRate),
    rubricSamples: options.rubricSamples,
    security: options.security,
    penalty: options.penalty,
  });

  return { result, outcome, metrics };
}
