/**
 * ceg verify：契约五件套可校验性自检（PRD §6.3）。
 *
 * ## 补齐的缺口
 *
 * `ceg init` 会落盘五件套（project.md / contract.json / rubric.yaml / checks.json /
 * evalset.json），`@cegueira/contract` 也提供了 `validateContract` / `validateRubric`，
 * 但**没有任何命令对已落盘的产物做校验**——用户手改 contract.json 或 rubric.yaml 后，
 * 错误要等到 `ceg grade` 才暴露（那时已跑完录制）。本命令把校验前置到「提交前」。
 *
 * ## 硬失败 vs 提示
 *
 * - 硬失败（任一即 `ok=false`）：文件缺失/不可解析、contract 校验不通过、
 *   rubric 校验不通过、`mandatory_tests` 未在 evalset 中定义。
 * - 提示（不影响 ok）：无 holdout 用例、checks 为空、evalset 为空——
 *   它们是质量建议，不是契约非法。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readText } from "../read.js";
import {
  validateContract,
  validateRubric,
  type Check,
  type Contract,
  type EvalSet,
  type Rubric,
} from "@cegueira/contract";
import { parse as parseYaml } from "yaml";

export interface VerifyItem {
  name: string;
  ok: boolean;
  /** 失败原因或说明。 */
  detail: string;
  /** true 表示这是「提示」而非硬失败。 */
  advisory?: boolean;
}

export interface VerifyResult {
  ok: boolean;
  items: VerifyItem[];
}

/** 五件套文件名。 */
const FILES = {
  project: "project.md",
  contract: "contract.json",
  rubric: "rubric.yaml",
  checks: "checks.json",
  evalset: "evalset.json",
} as const;

/** 读取并解析一个 JSON 文件；失败抛错（由调用方转成失败项）。 */
function readJson<T>(path: string): T {
  return JSON.parse(readText(path)) as T;
}

/** 校验契约五件套目录，返回逐项结果。 */
export function verifyBundle(dir: string): VerifyResult {
  const items: VerifyItem[] = [];
  const path = (name: string): string => join(dir, name);

  // 1. 五个文件必须齐全
  const missing = Object.values(FILES).filter((f) => !existsSync(path(f)));
  items.push({
    name: "五件套齐全",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "project/contract/rubric/checks/evalset 均存在" : `缺失 ${missing.join(", ")}`,
  });
  if (missing.length > 0) {
    return { ok: false, items };
  }

  // 2. contract.json 结构 + acceptance 可构造性
  let contract: Contract | undefined;
  try {
    contract = readJson<Contract>(path(FILES.contract));
    const r = validateContract(contract);
    items.push({ name: "contract 校验", ok: r.ok, detail: r.ok ? "结构合法，断言可构造" : r.reason });
  } catch (e) {
    items.push({ name: "contract 校验", ok: false, detail: `解析失败：${(e as Error).message}` });
  }

  // 2b. tool_call_in 白名单能否同时满足？
  // 单轨迹模型下 tool_call_in 是**全局**策略（任一越界即整条轨迹不通过），
  // 若各任务给了无交集的子集，则「任何用了工具的 Agent」都无法同时通过——
  // 属契约缺陷（提示，不硬失败）。
  if (contract) {
    const lists: Set<string>[] = [];
    for (const st of contract.stages ?? []) {
      for (const t of st.tasks ?? []) {
        for (const a of t.acceptance ?? []) {
          if (a.type === "tool_call_in" && Array.isArray(a.tools) && a.tools.length > 0) {
            lists.push(new Set(a.tools));
          }
        }
      }
    }
    if (lists.length >= 2) {
      const intersection = new Set([...lists[0]].filter((x) => lists.every((s) => s.has(x))));
      if (intersection.size === 0) {
        items.push({
          name: "tool_call_in 白名单可同时满足",
          ok: false,
          advisory: true,
          detail:
            "各任务的 tool_call_in 无交集：单轨迹模型下任何用了工具的 Agent 都无法同时通过，建议合并为一份全局白名单",
        });
      }
    }
  }

  // 3. rubric.yaml：安全三断言齐全 + outcome_min 合法
  let rubric: Rubric | undefined;
  try {
    rubric = parseYaml(readText(path(FILES.rubric))) as Rubric;
    const r = validateRubric(rubric);
    items.push({ name: "rubric 校验", ok: r.ok, detail: r.ok ? "安全断言齐全，outcome_min 合法" : r.reason });
  } catch (e) {
    items.push({ name: "rubric 校验", ok: false, detail: `解析失败：${(e as Error).message}` });
  }

  // 4. evalset：mandatory_tests 必须都在其中定义（硬失败）
  let evalset: EvalSet | undefined;
  try {
    evalset = readJson<EvalSet>(path(FILES.evalset));
    const ids = new Set((evalset.tests ?? []).map((t) => t.id));
    const missingMandatory = (rubric?.mandatory_tests ?? []).filter((t) => !ids.has(t));
    items.push({
      name: "evalset 覆盖 mandatory_tests",
      ok: missingMandatory.length === 0,
      detail:
        missingMandatory.length === 0
          ? `${ids.size} 条用例，mandatory 全部覆盖`
          : `mandatory_tests 未定义：${missingMandatory.join(", ")}`,
    });
    const hasHoldout = (evalset.tests ?? []).some((t) => t.splits === "holdout");
    items.push({
      name: "含留出集用例",
      ok: hasHoldout,
      advisory: !hasHoldout,
      detail: hasHoldout ? "存在 holdout 用例（防作弊防线 1 可用）" : "无 holdout 用例，防作弊留出集防线无从生效",
    });
  } catch (e) {
    items.push({ name: "evalset 解析", ok: false, detail: `解析失败：${(e as Error).message}` });
  }

  // 5. checks：非空且 layer 合法（空为提示）
  try {
    const checks = readJson<Check[]>(path(FILES.checks));
    const arr = Array.isArray(checks) ? checks : [];
    const badLayer = arr.filter((c) => c.layer !== "L1" && c.layer !== "L2");
    if (arr.length === 0) {
      items.push({ name: "checks 非空", ok: false, advisory: true, detail: "checks 为空，无 L1/L2 检测配方" });
    } else if (badLayer.length > 0) {
      items.push({
        name: "checks layer 合法",
        ok: false,
        detail: `layer 应为 L1/L2：${badLayer.map((c) => c.id).join(", ")}`,
      });
    } else {
      items.push({ name: "checks layer 合法", ok: true, detail: `${arr.length} 条配方` });
    }
  } catch (e) {
    items.push({ name: "checks 解析", ok: false, detail: `解析失败：${(e as Error).message}` });
  }

  const ok = items.every((i) => i.ok || i.advisory);
  return { ok, items };
}

/** 渲染校验报告文本。 */
export function verifyCommand(dir: string): string {
  const result = verifyBundle(dir);
  const lines = [`契约自检（${dir}）：${result.ok ? "通过 ✓" : "未通过 ✗"}`];
  for (const i of result.items) {
    const mark = i.ok ? "✓" : i.advisory ? "⚠" : "✗";
    lines.push(`  ${mark} ${i.name}：${i.detail}`);
  }
  if (!result.ok) {
    lines.push("修复上方 ✗ 项后重试；⚠ 项为质量建议，不阻塞。");
  }
  return lines.join("\n");
}
