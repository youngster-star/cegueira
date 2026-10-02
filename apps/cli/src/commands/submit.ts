/**
 * ceg submit：提交评分（PRD §4 / P1 任务 6）。
 * 读取评分输入 JSON，跑评分引擎，输出报告。
 */
import { readFileSync } from "node:fs";
import { buildReport, score, type SecurityChecks, type ScoreInput } from "@cegueira/scorer";

/** 评分输入 JSON 结构（含可选多次采样分，用于报告统计）。 */
interface SubmitInput {
  outcomeSamples: number[];
  process: number;
  semantic?: number;
  rubricSamples?: number[];
  security: SecurityChecks;
  penalty?: number;
  sampledScores?: number[];
}

/** 提交评分：读输入文件 → 评分 → 返回报告文本。 */
export function submitCommand(inputPath: string): string {
  const raw = readFileSync(inputPath, "utf8");
  const data = JSON.parse(raw) as SubmitInput;

  const scoreInput: ScoreInput = {
    outcomeSamples: data.outcomeSamples,
    process: data.process,
    semantic: data.semantic,
    rubricSamples: data.rubricSamples,
    security: data.security,
    penalty: data.penalty,
  };
  const result = score(scoreInput);
  const sampled = data.sampledScores ?? [result.finalScore];
  const report = buildReport(result, sampled);

  const d = report.score.dimensions;
  const lines = [
    `最终得分：${report.score.finalScore}`,
    `S_core：${report.score.sCore.toFixed(4)}`,
    `维度：outcome=${d.outcome.toFixed(3)} process=${d.process.toFixed(3)} semantic=${d.semantic.toFixed(3)} rubric=${d.rubric.toFixed(3)}`,
    `安全门控：${report.score.gates.security.passed ? "通过" : `未通过 [${report.score.gates.security.violations.join(", ")}]`}`,
    `结果门控：${report.score.gates.outcome.passed ? "通过" : "驳回"}（outcome min=${report.score.gates.outcome.min.toFixed(3)}）`,
    `统计：mean=${report.stats.mean.toFixed(2)} std=${report.stats.std.toFixed(2)} worst=${report.stats.worst.toFixed(2)} CI=[${report.stats.ci[0].toFixed(2)}, ${report.stats.ci[1].toFixed(2)}] n=${report.stats.samples}`,
  ];
  return lines.join("\n");
}
