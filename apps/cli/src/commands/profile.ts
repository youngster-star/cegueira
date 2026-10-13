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
import { aggregateSkill, isLucidez, LEVELS } from "@cegueira/profile";
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
}

/** 聚合画像并落库，返回报告文本。 */
export function profileCommand(opts: ProfileOptions): string {
  const store = createJsonFilePersistence(opts.storeDir);
  const scores = store.scores.list();

  if (scores.length === 0) {
    return `技能画像（${opts.storeDir}）：暂无评分记录，先跑 ceg grade --store。`;
  }

  const titleById = new Map(store.projects.list().map((p) => [p.id, p.title] as const));

  // 按技能维度分组：维度 → { 分数列表, 最近评估时间 }
  const groups = new Map<string, { scores: number[]; last: string }>();
  for (const s of scores) {
    const skill = opts.skill ?? titleById.get(s.projectId) ?? s.projectId;
    const g = groups.get(skill) ?? { scores: [], last: "" };
    g.scores.push(s.finalScore);
    if (s.createdAt > g.last) g.last = s.createdAt;
    groups.set(skill, g);
  }

  const now = opts.now ?? new Date().toISOString();
  const skills: Record<string, SkillProfile> = {};
  const lines: string[] = [`技能画像（${opts.storeDir}）：共 ${groups.size} 个技能维度`];
  let lucidez = false;

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
    // 成就须「确定」在掌握档之上：评估中（不确定度过高）不授予，避免误判（PRD §5.2/§5.6）
    if (isLucidez(profile.level) && profile.state !== "assessing") lucidez = true;
    const name = LEVELS.find((l) => l.level === profile.level)?.name ?? "";
    lines.push(
      `  ${skill}：${profile.score.toFixed(2)}/10 第 ${profile.level} 档（${name}）` +
        ` 不确定度 ${profile.uncertainty.toFixed(3)} 状态 ${profile.state}（${g.scores.length} 次）`,
    );
  }

  const record: ProfileRecord = {
    id: opts.id ?? "local",
    skills,
    ladder: { l3Requests: 0, l4Requests: 0 }, // 阶梯使用记录尚未落库
    achievements: { lucidez },
    updatedAt: now,
  };
  store.profiles.save(record);

  lines.push(lucidez ? "成就：已进入「掌握」档 → Lucidez。" : "成就：尚未进入「掌握」档。");
  lines.push(`已写入 profiles 集合（id=${record.id}）。`);
  return lines.join("\n");
}
