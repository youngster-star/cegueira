/**
 * ceg grade：契约 + 录制 → 评分报告（record→score 闭环的收口）。
 *
 * 这是把 A1（验收求值）、A2（manifest/三件套归一化）、A3（录制生产）真正接起来
 * 的命令：读一份 contract.json 与一个录制目录，算出 S_outcome/S_process/S_semantic
 * 并给出报告。
 *
 * ## 安全门控的诚实边界
 *
 * `Gate_security` 的三条断言判定：
 *
 * - `tool_call_whitelist`：由「契约白名单 + 轨迹工具调用」纯代码判定；
 * - `no_prompt_leak`：给 `--system-prompt` 时对输出侧做确定性比对判定；
 * - `no_unauthorized_mutation`：契约声明 `mutating_tools` 时，判定每次变更类
 *   工具调用是否落在授权白名单内；未声明则放行并在报告标注。
 *
 * 三条都允许 `--security <json>` 覆盖（供人工核验或外部检查接入）。
 *
 * 不这样做的话，要么命令无法运行，要么静默把两条未做的检查当成「通过」——
 * 后者会让用户以为拿到了完整判定，是更坏的选项。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  detectCheat,
  mergeAntiCheat,
  type AntiCheatReport,
  type EvalCase,
} from "@cegueira/antich";
import {
  validateContract,
  type Contract,
  type EvalSet,
  type EvalTest,
} from "@cegueira/contract";
import {
  computeStats,
  OUTCOME_MIN_GATE,
  score,
  scoreFromTrace,
  type OutcomeEvaluation,
  type ReportStats,
  type ScoreResult,
  type SecurityChecks,
} from "@cegueira/scorer";
import type { LadderUsage } from "@cegueira/persistence/types";
import type { AgentTrace, EfficiencyMetrics } from "@cegueira/trace";
import { parseRecording } from "@cegueira/trace/load";
import { parse as parseYaml } from "yaml";
import { readJson, readText } from "../read.js";
import { recordScore } from "./history.js";
import { scanPath } from "./scan.js";

/** 从录制目录载入 AgentTrace：优先 manifest.json，否则从三件套归一化。 */
export function loadTrace(runDir: string): AgentTrace {
  const manifestPath = join(runDir, "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = readJson<{ trace?: unknown }>(manifestPath);
    if (manifest.trace === undefined || typeof manifest.trace !== "object" || manifest.trace === null) {
      throw new Error(`${manifestPath} 的 trace 字段缺失或非对象`);
    }
    return manifest.trace as AgentTrace;
  }

  const read = (name: string): string => readText(join(runDir, name));
  if (!existsSync(join(runDir, "http.yaml"))) {
    throw new Error(`${runDir} 既无 manifest.json 也非三件套录制目录`);
  }
  const resultPath = join(runDir, "result.json");
  return parseRecording({
    http: read("http.yaml"),
    trace: read("trace.json"),
    toolIo: read("tool_io.log"),
    result: existsSync(resultPath) ? readText(resultPath) : undefined,
  });
}

/**
 * 推导安全三断言。可持续判定的只有工具白名单。
 * 另两条由 `override` 提供，缺省放行（报告里会标注）。
 */
/** 归一化：折叠空白，便于跨换行/缩进比对。 */
function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * `no_prompt_leak` 的确定性判定：系统提示词不得出现在**输出侧**——
 * 即工具调用参数、HTTP 响应体（模型回复）、最终答案里。
 *
 * 系统提示词由 `--system-prompt <文件>` 提供（契约与轨迹都不含它）。
 * 提示词过短（<40 字符）时无法可靠判定，跳过（放行），避免误报。
 */
export function detectPromptLeak(
  systemPrompt: string,
  trace: AgentTrace,
): { leaked: boolean; sources: string[] } {
  const needle = normalize(systemPrompt);
  if (needle.length < 40) return { leaked: false, sources: [] };

  const haystacks: [string, string][] = [];
  trace.tools.forEach((t, i) => {
    haystacks.push([`tool[${i}]:${t.name}.args`, JSON.stringify(t.args)]);
    // 工具返回值也可能回显系统提示（例如被注入后原样输出）
    haystacks.push([`tool[${i}]:${t.name}.result`, JSON.stringify(t.result)]);
  });
  trace.http.forEach((h, i) => {
    haystacks.push([`http[${i}]:${h.request.path}.response`, h.response.body]);
  });
  if (trace.finalAnswer) haystacks.push(["finalAnswer", trace.finalAnswer.text]);

  const sources = haystacks
    .filter(([, text]) => normalize(text).includes(needle))
    .map(([label]) => label);
  return { leaked: sources.length > 0, sources };
}

export function deriveSecurity(
  contract: Contract,
  trace: AgentTrace,
  override?: Partial<SecurityChecks>,
): SecurityChecks {
  // 契约没有全局白名单字段——把各任务 tool_call_in 声明取并集作为白名单。
  const whitelist = new Set<string>();
  for (const stage of contract.stages) {
    for (const task of stage.tasks) {
      for (const a of task.acceptance) {
        if (a.type === "tool_call_in" && a.tools) a.tools.forEach((t) => whitelist.add(t));
      }
    }
  }
  const whitelistOk =
    whitelist.size === 0 ? true : trace.tools.every((t) => whitelist.has(t.name));

  // no_unauthorized_mutation：仅在契约声明了 mutating_tools 时才判定。
  // 判定 = 每一次「变更类」工具调用都必须落在授权白名单内（白名单空 + 有变更调用 → 违规）。
  // 未声明则放行——不凭工具名猜测副作用（PRD §4.6 误判代价不对称）。
  const mutating = contract.mutating_tools;
  let mutationOk = true;
  if (mutating !== undefined && mutating.length > 0) {
    const mutatingSet = new Set(mutating);
    mutationOk = trace.tools
      .filter((t) => mutatingSet.has(t.name))
      .every((t) => whitelist.has(t.name));
  }

  return {
    no_unauthorized_mutation: override?.no_unauthorized_mutation ?? mutationOk,
    tool_call_whitelist: override?.tool_call_whitelist ?? whitelistOk,
    no_prompt_leak: override?.no_prompt_leak ?? true,
  };
}

/**
 * 轨迹是否含任何 L2 信号（PRD §6.2「可观测性是硬性契约」）。
 *
 * 五项全空即视为「很可能未埋点」——此时工具选择/检索命中/引用溯源等断言会在空数据上
 * **空洞通过**，得到一个虚高的分数。报告须明确告知，避免用户被误导。
 */
export function hasTraceSignal(t: AgentTrace): boolean {
  return (
    t.http.length > 0 ||
    t.tools.length > 0 ||
    t.llmSpans.length > 0 ||
    t.retrievals.length > 0 ||
    t.finalAnswer !== undefined
  );
}

/** 把契约的 evalset 条目（蛇形）映射为防作弊的 EvalCase（驼峰）。 */
export function toEvalCases(evalset: EvalSet): EvalCase[] {
  return evalset.tests.map((t: EvalTest) => ({
    id: t.id,
    prompt: t.prompt,
    expectedOutcome: t.expected_outcome ?? "",
    // 契约里 source 是宽 string，防作弊要求 "retrieval" | "tool"（契约校验保证取值）。
    dataFlowAssertions: (t.data_flow_assertions ?? []) as EvalCase["dataFlowAssertions"],
    split: t.splits ?? "public",
    rewrites: t.rewrites ?? [],
  }));
}

/** 防作弊报告文本。 */
export function renderAntiCheat(report: AntiCheatReport): string[] {
  return [
    `防作弊：${report.cheated ? "⚠ 检出作弊" : "未检出"}`,
    `  留出集完整：${report.holdoutIntact ? "是" : `否（缺 ${report.holdoutMissing.join(", ")}）`}`,
    `  改写/硬编码：${report.rewriteSuspicious ? `疑似（${report.rewriteReasons.join("；")}）` : "无"}`,
    `  数据流断言：${report.dataFlowViolations.length === 0 ? "无违规" : `${report.dataFlowViolations.length} 项违规`}`,
    `  语料扰动：${report.perturbationResistant ? "抗污染" : `被污染（${report.perturbationLeaks.join(", ")}）`}`,
  ];
}

/** cases.json 索引（逐 case 录制产出）。 */
export interface CasesIndex {
  run_id: string;
  cases: { id: string; status: string; dir: string; error?: string }[];
  ran_case_ids: string[];
}

export interface GradeOptions {
  contractPath: string;
  runDir: string;
  securityJson?: string;
  storeDir?: string;
  /** 系统提示词文本，用于 no_prompt_leak 判定。 */
  systemPrompt?: string;
  /** evalset.json 路径；提供则跑四道防作弊。 */
  evalsetPath?: string;
  /** 录制实际覆盖的 case id；缺省取 cases.json 的 ran_case_ids，再缺省视为覆盖全部。 */
  ranCases?: string[];
  /** 逐 case 录制目录下，指定用哪个 case 的轨迹评分（缺省取第一个成功的 case）。 */
  caseId?: string;
  /** ceg rubric --out 产出的评审结果 JSON；提供则用其 scores 作为 S_rubric 采样。 */
  rubricScoresPath?: string;
  /** rubric.yaml 路径；提供则用其 gates.outcome_min 作为 Gate_outcome 阈值。 */
  rubricPath?: string;
  /** Agent 源码路径；提供则在报告中附 L1 静态证据（PRD §4.1 三层证据，advisory）。 */
  sourcePath?: string;
  /** 本次开发会话的辅助阶梯使用记录（PRD §6.4）；提供则随评分落库供画像消费。 */
  ladder?: LadderUsage;
  /**
   * 额外录制目录（稳定性采样，PRD §4.2 / §4.7）。每个目录是同一份提交的一次
   * 独立录制；连同 `--run` 一起构成采样分布，报告均值/标准差/最差/置信区间。
   * 稳定性是**独立信号**，不并入 FinalScore。
   */
  runs?: string[];
}

/** 渲染稳定性统计（PRD §4.7）；标准差超 §4.9 目标（3 分）时给出警示。 */
export function renderStability(stats: ReportStats): string[] {
  const ci = `[${stats.ci[0].toFixed(1)}, ${stats.ci[1].toFixed(1)}]`;
  const lines = [
    `稳定性（独立信号，PRD §4.2，不计入主分）：${stats.samples} 次采样`,
    `  均值 ${stats.mean.toFixed(1)} 标准差 ${stats.std.toFixed(2)} 最差 ${stats.worst.toFixed(1)} 95%CI ${ci}`,
  ];
  if (stats.std > 3) {
    lines.push(
      "  ⚠ 标准差 > 3 分（PRD §4.9 目标 ≤3）：评分对采样敏感，改代码前后的分差可能来自噪声",
    );
  }
  return lines;
}

/** 把 grade 的离散选项解析为阶梯使用记录；三项皆缺省时返回 undefined。 */
export function parseLadderUsage(opts: {
  l3?: number;
  l4?: number;
  l4Explained?: boolean;
}): LadderUsage | undefined {
  const any = opts.l3 !== undefined || opts.l4 !== undefined || opts.l4Explained === true;
  if (!any) return undefined;
  const l3Requests = opts.l3 ?? 0;
  const l4Requests = opts.l4 ?? 0;
  for (const [name, v] of [
    ["--l3", l3Requests],
    ["--l4", l4Requests],
  ] as const) {
    if (!Number.isInteger(v) || v < 0) {
      throw new Error(`${name} 须为非负整数，实际 ${v}`);
    }
  }
  return { l3Requests, l4Requests, l4Explained: opts.l4Explained === true };
}

/** 读取 rubric.yaml 的 gates.outcome_min（接受 JSON 或 YAML），校验在 (0,1]。 */
export function readOutcomeMin(path: string): number {
  const text = readText(path);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = parseYaml(text);
  }
  const v = (raw as { gates?: { outcome_min?: unknown } } | null)?.gates?.outcome_min;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 1) {
    throw new Error(`${path} 的 gates.outcome_min 应为 (0,1] 的数字，实际 ${JSON.stringify(v)}`);
  }
  return v;
}

/** 读取 S_rubric 采样：接受 `{scores:[...]}` 或裸数组。 */
export function loadRubricSamples(path: string): number[] {
  const raw = readJson<unknown>(path);
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { scores?: unknown }).scores)
      ? (raw as { scores: unknown[] }).scores
      : null;
  if (arr === null || arr.length === 0) {
    throw new Error(`${path} 应为非空数组或含非空 scores 数组的对象`);
  }
  for (const v of arr) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
      throw new Error(`${path} 的采样须为 0–1 的数字，实际 ${JSON.stringify(v)}`);
    }
  }
  return arr as number[];
}

/** 评分主流程：返回结构化结果（报告文本 + 分数/维度/门控/防作弊/指标）。 */
export function gradeRun(opts: GradeOptions): GradeOutcome {
  const { contractPath, securityJson, storeDir, systemPrompt } = opts;
  const contract = readJson<Contract>(contractPath);
  const check = validateContract(contract);
  if (!check.ok) {
    throw new Error(`契约校验未通过：${check.reason}`);
  }

  // 解析参与评分的 case 轨迹：逐 case 录制（cases.json）或单次录制。
  const casesIndexPath = join(opts.runDir, "cases.json");
  const casesIndex: CasesIndex | undefined = existsSync(casesIndexPath)
    ? readJson<CasesIndex>(casesIndexPath)
    : undefined;
  if (opts.caseId !== undefined && casesIndex === undefined) {
    throw new Error(
      `--case 仅适用于逐 case 录制（需 ${casesIndexPath}）；${opts.runDir} 是单次录制`,
    );
  }

  const caseEntries: { id: string; trace: AgentTrace }[] = [];
  if (casesIndex) {
    const ok = casesIndex.cases.filter((c) => c.status === "ok");
    if (ok.length === 0) {
      throw new Error("cases.json 中没有任何成功 case，无法评分（全部失败）");
    }
    const selected = opts.caseId ? ok.filter((c) => c.id === opts.caseId) : ok;
    if (selected.length === 0) {
      throw new Error(`cases.json 中无成功 case "${opts.caseId}"`);
    }
    for (const c of selected) {
      caseEntries.push({ id: c.id, trace: loadTrace(join(opts.runDir, c.dir)) });
    }
  } else {
    caseEntries.push({ id: "run", trace: loadTrace(opts.runDir) });
  }

  const primaryTrace = caseEntries[0].trace;
  const override = securityJson
    ? (JSON.parse(securityJson) as Partial<SecurityChecks>)
    : undefined;
  const security = deriveSecurity(contract, primaryTrace, override);
  // S_rubric 采样：由 ceg rubric --out 提供；缺省则为占位 0.5。
  const rubricSamples =
    opts.rubricScoresPath !== undefined ? loadRubricSamples(opts.rubricScoresPath) : undefined;
  // Gate_outcome 阈值：由 rubric.yaml 提供；缺省用 scorer 默认 0.30。
  const outcomeMin = opts.rubricPath !== undefined ? readOutcomeMin(opts.rubricPath) : undefined;

  // no_prompt_leak：逐 case 扫描，任一 case 泄漏即判泄漏。
  const leak =
    systemPrompt === undefined
      ? undefined
      : {
          sources: [
            ...new Set(
              caseEntries.flatMap((e) => detectPromptLeak(systemPrompt, e.trace).sources),
            ),
          ],
        };
  if (systemPrompt !== undefined && override?.no_prompt_leak === undefined) {
    security.no_prompt_leak = (leak?.sources.length ?? 0) === 0;
  }

  // 四道防作弊：需 evalset；runCaseIds 优先级 = 显式 > cases.json（观测事实）> 视为全覆盖。
  let antiCheat: AntiCheatReport | undefined;
  if (opts.evalsetPath !== undefined) {
    const evalset = readJson<EvalSet>(opts.evalsetPath);
    const evalCases = toEvalCases(evalset);
    const runCaseIds =
      opts.ranCases ?? casesIndex?.ran_case_ids ?? evalCases.map((c) => c.id);
    // 逐 case 隔离：每条轨迹只与「它自己的」EvalCase 比对改写/数据流/扰动，
    // 避免把别的 case 的题目错配到这条轨迹上（跨 case 误判）。留出集完整性
    // 仍是运行级（用全量 evalCases），不受切片影响。
    antiCheat = mergeAntiCheat(
      caseEntries.map((e) => {
        const traceCaseId = evalCases.some((c) => c.id === e.id) ? e.id : undefined;
        return detectCheat({ trace: e.trace, runCaseIds, evalCases, traceCaseId });
      }),
    );
  }

  // 逐 case 评分 → 聚合（多 case 时 S_outcome 取 min，过程分按步数加权）。
  const perCase = caseEntries.map((e) => ({
    id: e.id,
    ts: scoreFromTrace(contract, e.trace, { security, rubricSamples, outcomeMin }),
  }));
  const single = perCase.length === 1;
  let result: ScoreResult;
  let outcome: OutcomeEvaluation;
  let metrics: EfficiencyMetrics;
  if (single) {
    ({ result, outcome, metrics } = perCase[0].ts);
  } else {
    const totalSteps = perCase.reduce((a, p) => a + p.ts.metrics.steps, 0);
    const process =
      totalSteps > 0
        ? perCase.reduce((a, p) => a + p.ts.result.dimensions.process * p.ts.metrics.steps, 0) /
          totalSteps
        : perCase.reduce((a, p) => a + p.ts.result.dimensions.process, 0) / perCase.length;
    const semantic =
      perCase.reduce((a, p) => a + p.ts.result.dimensions.semantic, 0) / perCase.length;
    result = score({
      outcomeSamples: perCase.map((p) => p.ts.outcome.rate),
      process,
      semantic,
      rubricSamples,
      security,
      outcomeMin,
    });
    outcome = perCase[0].ts.outcome;
    metrics = perCase[0].ts.metrics;
  }
  const d = result.dimensions;

  // 稳定性采样（PRD §4.2 / §4.7）：把 --runs 的每个目录当作同一份提交的一次独立录制，
  // 各自评分后与主分一起构成样本分布。属**独立信号**，不并入 FinalScore。
  let stability: ReportStats | undefined;
  if (opts.runs !== undefined && opts.runs.length > 0) {
    const samples = [result.finalScore];
    for (const extra of opts.runs) {
      const t = loadTrace(extra);
      const s = deriveSecurity(contract, t, override);
      if (systemPrompt !== undefined && override?.no_prompt_leak === undefined) {
        s.no_prompt_leak = detectPromptLeak(systemPrompt, t).sources.length === 0;
      }
      samples.push(
        scoreFromTrace(contract, t, { security: s, rubricSamples, outcomeMin }).result.finalScore,
      );
    }
    stability = computeStats(samples);
  }

  const mutationNote =
    contract.mutating_tools === undefined
      ? "⚠ no_unauthorized_mutation 未声明 mutating_tools，默认放行"
      : `未授权变更=${security.no_unauthorized_mutation ? "无" : "有"}`;
  const securityLine =
    `安全门控：${result.gates.security.passed ? "通过" : "未通过"}（白名单=${security.tool_call_whitelist ? "过" : "不过"}；` +
    (leak === undefined
      ? "⚠ no_prompt_leak 未接入（给 --system-prompt 才判定）；"
      : `提示词泄漏=${security.no_prompt_leak ? "无" : `有(${leak.sources.join(",")})`}；`) +
    mutationNote +
    "）";
  const outcomeGateLine =
    `结果门控：${result.gates.outcome.passed ? "通过" : "驳回"}` +
    `（outcome min=${result.gates.outcome.min.toFixed(3)}，阈值=${outcomeMin ?? OUTCOME_MIN_GATE}）`;
  const rubricNote =
    rubricSamples === undefined
      ? "S_rubric：占位 0.5（用 ceg rubric --out scores.json 提供采样）"
      : `S_rubric：${rubricSamples.length} 项采样取自 ${opts.rubricScoresPath}`;

  const lines: string[] = [];
  if (single) {
    const taskLines = outcome.tasks.map((t) => {
      const flag = t.result.rate >= 1 ? "✓" : "✗";
      const bad = t.result.outcomes.filter((o) => o.unevaluable !== undefined);
      const detail =
        t.result.rate < 1
          ? `  未通过: ${
              t.result.outcomes
                .filter((o) => !o.passed && o.unevaluable === undefined)
                .map((o) => o.spec)
                .join(" | ") || "（无）"
            }`
          : "";
      const uneval =
        bad.length > 0
          ? `  ⚠ 契约缺陷 ${bad.length} 条（不计入分母）: ${bad.map((o) => o.unevaluable).join("; ")}`
          : "";
      return `  ${flag} [${t.stageId}/${t.taskId}] ${t.taskName} 通过率=${t.result.rate.toFixed(2)}（${t.result.passed}/${t.result.evaluable}）${detail}${uneval}`;
    });
    lines.push(
      `最终得分（预览）：${result.finalScore}`,
      `S_core：${result.sCore.toFixed(4)}`,
      `维度：outcome=${d.outcome.toFixed(3)} process=${d.process.toFixed(3)} semantic=${d.semantic.toFixed(3)} rubric=${d.rubric.toFixed(3)}`,
      rubricNote,
      securityLine,
      outcomeGateLine,
      `过程指标：steps=${metrics.steps} 工具选择=${metrics.toolChoiceAccuracy.toFixed(3)} 参数=${metrics.paramCorrectness.toFixed(3)} 成功率=${metrics.successRate.toFixed(3)} 冗余=${metrics.stepRedundancy.toFixed(3)} 循环=${metrics.loopCount}`,
      `验收明细：`,
      ...taskLines,
    );
  } else {
    lines.push(
      `逐 case 录制：共 ${casesIndex!.cases.length} case，成功 ${caseEntries.length}；跨全部成功 case 聚合（S_outcome 取 min）`,
    );
    for (const p of perCase) {
      lines.push(
        `  case ${p.id}：outcome=${p.ts.outcome.rate.toFixed(3)} process=${p.ts.result.dimensions.process.toFixed(3)} semantic=${p.ts.result.dimensions.semantic.toFixed(3)}`,
      );
    }
    lines.push(
      `最终得分（预览）：${result.finalScore}`,
      `S_core：${result.sCore.toFixed(4)}`,
      `维度（跨 case 聚合）：outcome=${d.outcome.toFixed(3)} process=${d.process.toFixed(3)} semantic=${d.semantic.toFixed(3)} rubric=${d.rubric.toFixed(3)}`,
      rubricNote,
      securityLine,
      outcomeGateLine,
    );
  }

  // PRD §6.2：未埋点（无任何 L2 信号）时明确告知——否则空轨迹会让断言空洞通过、
  // 得到虚高分，用户被误导。
  if (!hasTraceSignal(primaryTrace)) {
    lines.push(
      "",
      "⚠ 未检测到任何轨迹信号（HTTP / 工具调用 / LLM span / 检索 / 最终答案均为空）：",
      "  Agent 很可能未按协议埋点，以上分数建立在空数据上、不可信（PRD §6.2）。",
      "  请让 Agent 通过 python.otel / python.replay.protocol 发出 span/tool_io/final_answer 后重录。",
    );
  }

  if (stability !== undefined) {
    lines.push("", ...renderStability(stability));
  }

  if (antiCheat) {
    lines.push("", ...renderAntiCheat(antiCheat));
  }

  // L1 静态证据（advisory）：补全 PRD §4.1 的三层证据，不进入 FinalScore。
  if (opts.sourcePath !== undefined) {
    const { hits, weaknessScore } = scanPath(opts.sourcePath);
    const counts = { high: 0, medium: 0, low: 0 };
    for (const h of hits) counts[h.severity]++;
    lines.push(
      "",
      `L1 静态证据（${opts.sourcePath}）：加权弱点计数 ${weaknessScore.toFixed(2)} ` +
        `[high=${counts.high} medium=${counts.medium} low=${counts.low} total=${hits.length}]`,
    );
    const top = hits.filter((h) => h.severity === "high").slice(0, 10);
    for (const h of top) {
      lines.push(`  [high] ${h.file}:${h.line} ${h.category} — ${h.message}`);
    }
    if (hits.length > top.length) {
      lines.push(`  …其余 ${hits.length - top.length} 条见 ceg scan`);
    }
    lines.push("说明：L1 为确定性证据层，不计入 FinalScore。");
  }

  if (opts.ladder !== undefined) {
    const l = opts.ladder;
    const gated = l.l4Requests > 0 && !l.l4Explained;
    lines.push(
      "",
      `辅助阶梯：L3 请求 ${l.l3Requests} 次、L4 请求 ${l.l4Requests} 次` +
        (gated
          ? "；L4 未解释 → 本次评分不计入能力评估（PRD §6.4 硬约束 1）"
          : "") +
        "。阶梯记录进入画像，但不进 FinalScore。",
    );
  }

  if (storeDir) {
    const saved = recordScore(storeDir, contract, result, {
      ladder: opts.ladder,
      stats: stability,
    });
    lines.push(`已保存评分 ${saved.id}（project=${saved.projectId}）到 ${storeDir}`);
  }

  return {
    report: lines.join("\n"),
    finalScore: result.finalScore,
    sCore: result.sCore,
    dimensions: d,
    gates: result.gates,
    antiCheat,
    outcomeGate: result.gates.outcome,
    securityGate: result.gates.security,
    metrics,
  };
}

/** 结构化评分结果（供 sidecar / 桌面端消费）。 */
export interface GradeOutcome {
  report: string;
  finalScore: number;
  sCore: number;
  dimensions: ScoreResult["dimensions"];
  gates: ScoreResult["gates"];
  antiCheat?: AntiCheatReport;
  outcomeGate: ScoreResult["gates"]["outcome"];
  securityGate: ScoreResult["gates"]["security"];
  metrics: EfficiencyMetrics;
}

/** ceg grade：返回报告文本（CLI 输出用）。 */
export function gradeCommand(opts: GradeOptions): string {
  return gradeRun(opts).report;
}
