/**
 * ceg grade：契约 + 录制 → 评分报告（record→score 闭环的收口）。
 *
 * 这是把 A1（验收求值）、A2（manifest/三件套归一化）、A3（录制生产）真正接起来
 * 的命令：读一份 contract.json 与一个录制目录，算出 S_outcome/S_process/S_semantic
 * 并给出报告。
 *
 * ## 安全门控的诚实边界
 *
 * `Gate_security` 的三条断言里，只有 `tool_call_whitelist` 能由「契约白名单 +
 * 轨迹工具调用」纯代码判定。另两条（`no_unauthorized_mutation` / `no_prompt_leak`）
 * 需要 L1 静态扫描与系统提示词比对，尚未接入。因此本命令：
 *
 * - 白名单自动判定；
 * - 另两条默认放行，但**在报告里显式标注未接入**；
 * - 允许 `--security <json>` 覆盖（供后续接入或人工核验）。
 *
 * 不这样做的话，要么命令无法运行，要么静默把两条未做的检查当成「通过」——
 * 后者会让用户以为拿到了完整判定，是更坏的选项。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateContract, type Contract } from "@cegueira/contract";
import { scoreFromTrace, type SecurityChecks } from "@cegueira/scorer";
import type { AgentTrace } from "@cegueira/trace";
import { parseRecording } from "@cegueira/trace/load";
import { recordScore } from "./history.js";

/** 从录制目录载入 AgentTrace：优先 manifest.json，否则从三件套归一化。 */
export function loadTrace(runDir: string): AgentTrace {
  const manifestPath = join(runDir, "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      trace?: unknown;
    };
    if (manifest.trace === undefined || typeof manifest.trace !== "object" || manifest.trace === null) {
      throw new Error(`${manifestPath} 的 trace 字段缺失或非对象`);
    }
    return manifest.trace as AgentTrace;
  }

  const read = (name: string): string => readFileSync(join(runDir, name), "utf8");
  if (!existsSync(join(runDir, "http.yaml"))) {
    throw new Error(`${runDir} 既无 manifest.json 也非三件套录制目录`);
  }
  const resultPath = join(runDir, "result.json");
  return parseRecording({
    http: read("http.yaml"),
    trace: read("trace.json"),
    toolIo: read("tool_io.log"),
    result: existsSync(resultPath) ? readFileSync(resultPath, "utf8") : undefined,
  });
}

/**
 * 推导安全三断言。可持续判定的只有工具白名单。
 * 另两条由 `override` 提供，缺省放行（报告里会标注）。
 */
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

  return {
    no_unauthorized_mutation: override?.no_unauthorized_mutation ?? true,
    tool_call_whitelist: override?.tool_call_whitelist ?? whitelistOk,
    no_prompt_leak: override?.no_prompt_leak ?? true,
  };
}

/** 评分报告文本。 */
export function gradeCommand(
  contractPath: string,
  runDir: string,
  securityJson?: string,
  storeDir?: string,
): string {
  const contract = JSON.parse(readFileSync(contractPath, "utf8")) as Contract;
  const check = validateContract(contract);
  if (!check.ok) {
    throw new Error(`契约校验未通过：${check.reason}`);
  }

  const trace = loadTrace(runDir);
  const override = securityJson
    ? (JSON.parse(securityJson) as Partial<SecurityChecks>)
    : undefined;
  const security = deriveSecurity(contract, trace, override);

  const { result, outcome, metrics } = scoreFromTrace(contract, trace, { security });
  const d = result.dimensions;

  const taskLines = outcome.tasks.map((t) => {
    const flag = t.result.rate >= 1 ? "✓" : "✗";
    const bad = t.result.outcomes.filter((o) => o.unevaluable !== undefined);
    const detail =
      t.result.rate < 1
        ? `  未通过: ${t.result.outcomes
            .filter((o) => !o.passed && o.unevaluable === undefined)
            .map((o) => o.spec)
            .join(" | ") || "（无）"}`
        : "";
    const uneval =
      bad.length > 0
        ? `  ⚠ 契约缺陷 ${bad.length} 条（不计入分母）: ${bad.map((o) => o.unevaluable).join("; ")}`
        : "";
    return `  ${flag} [${t.stageId}/${t.taskId}] ${t.taskName} 通过率=${t.result.rate.toFixed(2)}（${t.result.passed}/${t.result.evaluable}）${detail}${uneval}`;
  });

  const lines = [
    `最终得分（预览）：${result.finalScore}`,
    `S_core：${result.sCore.toFixed(4)}`,
    `维度：outcome=${d.outcome.toFixed(3)} process=${d.process.toFixed(3)} semantic=${d.semantic.toFixed(3)} rubric=${d.rubric.toFixed(3)}`,
    `安全门控：${result.gates.security.passed ? "通过" : "未通过"}（白名单=${security.tool_call_whitelist ? "过" : "不过"}；⚠ no_unauthorized_mutation / no_prompt_leak 未接入，默认放行）`,
    `结果门控：${result.gates.outcome.passed ? "通过" : "驳回"}（outcome min=${result.gates.outcome.min.toFixed(3)}）`,
    `过程指标：steps=${metrics.steps} 工具选择=${metrics.toolChoiceAccuracy.toFixed(3)} 参数=${metrics.paramCorrectness.toFixed(3)} 成功率=${metrics.successRate.toFixed(3)} 冗余=${metrics.stepRedundancy.toFixed(3)} 循环=${metrics.loopCount}`,
    `验收明细：`,
    ...taskLines,
  ];

  if (storeDir) {
    const saved = recordScore(storeDir, contract, result);
    lines.push(`已保存评分 ${saved.id}（project=${saved.projectId}）到 ${storeDir}`);
  }
  return lines.join("\n");
}
