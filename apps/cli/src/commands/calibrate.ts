/**
 * ceg calibrate：对评分可信度跑校准报告（PRD §4.9 / P4 阶段）。
 *
 * ## 为什么做成独立命令
 *
 * `@cegueira/calibration` 的算法从 P4 起就齐全（QWK / 决策准确性 / 误拒率 /
 * 一致性 / 重复标准差 + 硬底线自动禁用），但一直没有消费方——因为「≥200 条
 * 人工标注」得靠人采集。本命令把「算法」与「数据集」解耦：把人工标注喂进来，
 * 立刻得到一份可判定达标与否的报告，硬底线（QWK < 0.60）不达标时明确提示
 * 「评分功能不启用」。
 *
 * ## 输入文件
 *
 * ```json
 * {
 *   "samples": [{"id":"p1","predicted":4,"human":3}],
 *   "repeated": [{"id":"p1","first":4,"second":4}],
 *   "repeatScores": [[80,82,79,83,81]]
 * }
 * ```
 * `repeated` 与 `repeatScores` 可选；`samples` 必填且非空。
 */
import { readFileSync } from "node:fs";
import {
  buildCalibrationReport,
  type CalibrationSample,
  type CalibrationReport,
  type RepeatedSample,
} from "@cegueira/calibration";

export interface CalibrateOptions {
  labelsPath: string;
}

export interface CalibrationInput {
  samples: CalibrationSample[];
  repeated?: RepeatedSample[];
  repeatScores?: number[][];
}

/** 解析人工标注文件，做形状与档位校验。 */
export function parseCalibrationFile(text: string): CalibrationInput {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const samples = raw.samples;
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error("校准文件需含非空 samples 数组");
  }
  const parsed: CalibrationSample[] = samples.map((entry, i) => {
    const s = entry as { id?: unknown; predicted?: unknown; human?: unknown };
    if (typeof s.id !== "string" || typeof s.predicted !== "number" || typeof s.human !== "number") {
      throw new Error(`samples[${i}] 需含 id(string)/predicted(number)/human(number)`);
    }
    return { id: s.id, predicted: s.predicted, human: s.human };
  });

  let repeated: RepeatedSample[] | undefined;
  if (raw.repeated !== undefined) {
    if (!Array.isArray(raw.repeated)) throw new Error("repeated 须为数组");
    repeated = raw.repeated.map((entry, i) => {
      const r = entry as { id?: unknown; first?: unknown; second?: unknown };
      if (typeof r.id !== "string" || typeof r.first !== "number" || typeof r.second !== "number") {
        throw new Error(`repeated[${i}] 需含 id(string)/first(number)/second(number)`);
      }
      return { id: r.id, first: r.first, second: r.second };
    });
  }

  let repeatScores: number[][] | undefined;
  if (raw.repeatScores !== undefined) {
    if (
      !Array.isArray(raw.repeatScores) ||
      raw.repeatScores.some(
        (row) =>
          !Array.isArray(row) ||
          row.some((v) => typeof v !== "number" || !Number.isFinite(v)),
      )
    ) {
      throw new Error("repeatScores 须为二维数字数组");
    }
    repeatScores = raw.repeatScores as number[][];
  }

  return { samples: parsed, repeated, repeatScores };
}

/** 渲染报告文本。 */
export function renderCalibrationReport(report: CalibrationReport): string {
  const m = report.metrics;
  const lines = [
    "校准报告（PRD §4.9）：",
    `  样本量：${m.sampleSize}`,
    `  QWK：${m.qwk.toFixed(3)}（目标 ≥0.70，硬底线 ≥0.60）`,
    `  决策准确性（相邻档）：${m.decisionAccuracy.toFixed(3)}（目标 ≥0.80）`,
    `  误拒率：${m.falseRejectRate.toFixed(3)}（上限 ≤0.03）`,
    `  决策一致性（重测同档）：${report.decisionConsistency.toFixed(3)}（目标 ≥0.75）`,
    `  重复评分标准差：均值 ${report.repeatStdDev.mean.toFixed(2)} / 最大 ${report.repeatStdDev.max.toFixed(2)}（上限 ≤3）`,
    "",
  ];
  const failed = Object.entries(report.checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  if (report.passed) {
    lines.push("结论：全部达标，校准通过。");
  } else {
    lines.push(`结论：未通过。未达标项：${failed.join(", ")}`);
    if (!report.checks.qwk_hard_floor) {
      lines.push("⚠ 硬底线（QWK < 0.60）未达 → 评分功能不启用（PRD §4.9）。");
    }
    lines.push(`原因：${report.reasons.join("；")}`);
  }
  return lines.join("\n");
}

/** 执行校准，返回报告文本。 */
export function calibrateCommand(opts: CalibrateOptions): string {
  const input = parseCalibrationFile(readFileSync(opts.labelsPath, "utf8"));
  const report = buildCalibrationReport(input.samples, input.repeated, input.repeatScores);
  return renderCalibrationReport(report);
}
