/**
 * ceg profile：从落库评分聚合技能画像（PRD §5「评分→画像」闭环）。
 *
 * ## 补齐的缺口
 *
 * `@cegueira/profile`（六档 + 三态 + 不确定度/遗忘回升）与持久化 `profiles`
 * 集合都没有消费方——分数落在库里，但从未被汇总成「能力画像」。本命令把
 * 两者接通：读 scores → 按技能维度聚合 → upsert ProfileRecord。
 *
 * ## 技能维度的取值规则（重要假设）
 *
 * 契约目前**没有** skill/direction 字段，因此本命令的归类规则是：
 * 1. 显式 `--skill <名>`：把库里全部分数归入同一技能维度（用于单维度深耕）；
 * 2. 否则：以项目 `title` 为技能维度（每个项目自成一维）。
 *
 * 这是可用的 MVP 口径，但**不是** PRD §5.4 设想的跨项目维度（如把多个 RAG
 * 项目归入「RAG」）。待契约引入 skill taxonomy 后，改用契约字段即可，无需
 * 改动画像算法本身。
 */
import { readFileSync } from "node:fs";
import {
  aggregateSkill,
  evaluateCertification,
  HARD_DIFFICULTY,
  isLucidez,
  LEVEL5_MIN_PROJECTS,
  LEVEL6_MIN_PROJECTS,
  LEVELS,
  type ProjectEvidence,
} from "@cegueira/profile";
import { createJsonFilePersistence } from "@cegueira/persistence/persistence";
import type { ProfileRecord, SkillProfile } from "@cegueira/persistence/types";

export interface ProfileOptions {
  storeDir: string;
  /** 强制把所有分数归入此技能维度；缺省按项目 title 分组。 */
  skill?: string;
  /** 「当前」时间（ISO），测试用。 */
  now?: string;
  /** 画像记录 id（单机默认 "local"）。 */
  id?: string;
  /**
   * 顶级档认证证据文件（PRD §5.5）。形如
   * `{"projects":[{"projectId","difficulty","reproducible","adopted"}]}`。
   * 不提供则不做认证（报告如实标注「未提供证据」）。
   */
  evidencePath?: string;
}

/** 解析认证证据文件，逐条校验。 */
export function parseEvidence(text: string): ProjectEvidence[] {
  const raw = JSON.parse(text) as { projects?: unknown };
  if (!Array.isArray(raw.projects)) {
    throw new Error("证据文件需含 projects 数组");
  }
  return raw.projects.map((entry, i) => {
    const o = entry as {
      projectId?: unknown;
      difficulty?: unknown;
      reproducible?: unknown;
      adopted?: unknown;
    };
    if (typeof o.projectId !== "string" || o.projectId.length === 0) {
      throw new Error(`projects[${i}].projectId 应为非空字符串`);
    }
    if (
      typeof o.difficulty !== "number" ||
      !Number.isFinite(o.difficulty) ||
      o.difficulty < 0 ||
      o.difficulty > 10
    ) {
      throw new Error(`projects[${i}].difficulty 应为 [0,10] 的数字`);
    }
    if (typeof o.reproducible !== "boolean") {
      throw new Error(`projects[${i}].reproducible 应为布尔值`);
    }
    if (typeof o.adopted !== "boolean") {
      throw new Error(`projects[${i}].adopted 应为布尔值`);
    }
    return {
      projectId: o.projectId,
      difficulty: o.difficulty,
      reproducible: o.reproducible,
      adopted: o.adopted,
    };
  });
}

/** 聚合画像并落库，返回报告文本。 */
export function profileCommand(opts: ProfileOptions): string {
  const store = createJsonFilePersistence(opts.storeDir);
  const scores = store.scores.list();

  if (scores.length === 0) {
    return `技能画像（${opts.storeDir}）：暂无评分记录，先跑 ceg grade --store。`;
  }

  const titleById = new Map(store.projects.list().map((p) => [p.id, p.title] as const));

  // 辅助阶梯使用汇总（PRD §6.4 硬约束 3）：进入画像作负向信号，但不进 FinalScore。
  let l3Requests = 0;
  let l4Requests = 0;
  let l4Gated = 0; // 请求过 L4 却未解释、被排除出能力评估的评分次数

  // 按技能维度分组：维度 → { 分数列表, 最近评估时间 }
  const groups = new Map<string, { scores: number[]; last: string }>();
  for (const s of scores) {
    if (s.ladder) {
      l3Requests += s.ladder.l3Requests;
      l4Requests += s.ladder.l4Requests;
    }
    // 硬约束 1：给出 L4 代码后未用自己的话解释 → 该次评分不计入能力评估（技能分不升级）。
    // 只排除「本次评分」的贡献，历史有效样本仍参与聚合。
    if (s.ladder !== undefined && s.ladder.l4Requests > 0 && !s.ladder.l4Explained) {
      l4Gated++;
      continue;
    }
    const skill = opts.skill ?? titleById.get(s.projectId) ?? s.projectId;
    const g = groups.get(skill) ?? { scores: [], last: "" };
    g.scores.push(s.finalScore);
    if (s.createdAt > g.last) g.last = s.createdAt;
    groups.set(skill, g);
  }

  const now = opts.now ?? new Date().toISOString();
  const skills: Record<string, SkillProfile> = {};
  const lines: string[] = [`技能画像（${opts.storeDir}）：共 ${groups.size} 个技能维度`];
  if (l4Gated > 0) {
    lines.push(
      `  ⚠ ${l4Gated} 次评分因请求 L4 后未解释，未计入能力评估（PRD §6.4 硬约束 1）`,
    );
  }
  let lucidez = false;
  let topLevel = 0; // 最高档位，用于顶级档认证判定（PRD §5.5）

  // 稳定输出顺序：维度名排序
  for (const skill of [...groups.keys()].sort()) {
    const g = groups.get(skill)!;
    const { profile } = aggregateSkill({
      skill,
      finalScores: g.scores,
      lastAssessedAt: g.last,
      now,
    });
    skills[skill] = { ...profile, percentile: 0 }; // 人口百分位需群体数据，MVP 置 0
    topLevel = Math.max(topLevel, profile.level);
    // 成就须「确定」在掌握档（档 5）之上：评估中（不确定度过高）不授予，避免误判（PRD §5.2/§5.6）
    if (isLucidez(profile.level) && profile.state !== "assessing") lucidez = true;
    const name = LEVELS.find((l) => l.level === profile.level)?.name ?? "";
    lines.push(
      `  ${skill}：${profile.score.toFixed(2)}/10 第 ${profile.level} 档（${name}）` +
        ` 不确定度 ${profile.uncertainty.toFixed(3)} 状态 ${profile.state}（${g.scores.length} 次）`,
    );
  }

  // 顶级档双轨制（PRD §5.5）：分数达标只是必要条件，还须认证证据。
  const certification =
    opts.evidencePath !== undefined
      ? evaluateCertification(topLevel, parseEvidence(readFileSync(opts.evidencePath, "utf8")))
      : undefined;

  const record: ProfileRecord = {
    id: opts.id ?? "local",
    skills,
    ladder: { l3Requests, l4Requests },
    achievements: { lucidez },
    ...(certification !== undefined ? { certification } : {}),
    updatedAt: now,
  };
  store.profiles.save(record);

  if (certification !== undefined) {
    lines.push(
      "顶级档认证（PRD §5.5 双轨制）：",
      `  最高档：第 ${topLevel} 档` +
        (topLevel < 5 ? "（未达精通档分数门槛，认证不适用）" : "（已具备分数门槛）"),
      `  精通认证：需 ≥${LEVEL5_MIN_PROJECTS} 个「难度 ≥${HARD_DIFFICULTY} 且他人可复现」的项目，` +
        `当前 ${certification.hardReproducibleProjects} 个 → ${certification.level5 ? "通过 ✓" : "未通过"}`,
      `  大师认证：需 ≥${LEVEL6_MIN_PROJECTS} 个「被他人采用 / 方案被社区采纳」的项目，` +
        `当前 ${certification.adoptedProjects} 个 → ${certification.level6 ? "通过 ✓" : "未通过"}`,
    );
  } else {
    lines.push(
      "顶级档认证（PRD §5.5）：未提供证据（--evidence <json>），仅按分数档位展示；" +
        "顶级档（精通/大师）须叠加认证才成立。",
    );
  }

  // 阈值与 @cegueira/ladder.isOverReliant 对齐（L3+L4 > 3 即视为过度依赖）。
  const overReliant = l3Requests + l4Requests > 3;
  lines.push(
    `辅助阶梯：L3 请求 ${l3Requests} 次、L4 请求 ${l4Requests} 次` +
      (overReliant ? "（频繁依赖，掌握度可能被高估）" : ""),
  );
  lines.push(lucidez ? "成就：已进入「掌握」档 → Lucidez。" : "成就：尚未进入「掌握」档。");
  lines.push(`已写入 profiles 集合（id=${record.id}）。`);
  return lines.join("\n");
}
