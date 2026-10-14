/**
 * 评分落库与历史查询（`ceg grade --store` / `ceg history`）。
 *
 * ## 补齐的缺口
 *
 * `@cegueira/persistence` 早就提供了 projects / scores / profiles 三集合门面
 * （memory / jsonfile / sqlite 三种后端），但**没有任何消费方**——评出来的分
 * 只在终端一闪而过，桌面端与后续画像都没有数据可读。
 *
 * ## 用 JSON 文件后端而非 SQLite
 *
 * SQLite 后端（`node:sqlite`）在 Node 22 仍会打印 ExperimentalWarning 到
 * stderr，污染 CLI 输出；且部分 22.x 需要 `--experimental-sqlite` 才可用。
 * 桌面端 sidecar 版本可控，用 SQLite；CLI 先走稳定的 JSON 文件后端，
 * 两者共享同一 `Persistence` 门面，将来切换后端不影响调用方。
 */
import { randomUUID } from "node:crypto";
import type { Contract } from "@cegueira/contract";
// 走子路径导入，避免经 index 连带加载 sqlite（其 `node:sqlite` 会打印
// ExperimentalWarning 污染 CLI 输出）。CLI 只用 JSON 文件后端。
import { createJsonFilePersistence } from "@cegueira/persistence/persistence";
import type { LadderUsage, ProjectRecord, ScoreRecord } from "@cegueira/persistence/types";
import { buildReport, type ScoreResult } from "@cegueira/scorer";

export interface RecordScoreOptions {
  /** 覆盖时间戳（测试用；生产用当前 ISO 时间）。 */
  now?: string;
  /** 覆盖评分 id（测试用，保证确定性）。 */
  id?: string;
  /** 本次评分对应的辅助阶梯使用记录（PRD §6.4）；缺省不写入。 */
  ladder?: LadderUsage;
}

/**
 * 把一次评分落库：upsert 项目快照 + 追加一条评分记录。
 *
 * 项目按 `contract.project_id` upsert，`createdAt` 保持首次写入值，
 * `updatedAt` 刷新——否则每次评分都会在 projects 里堆一条新记录。
 */
export function recordScore(
  storeDir: string,
  contract: Contract,
  result: ScoreResult,
  options: RecordScoreOptions = {},
): ScoreRecord {
  const now = options.now ?? new Date().toISOString();
  const store = createJsonFilePersistence(storeDir);

  const existing = store.projects.get(contract.project_id);
  const project: ProjectRecord = {
    id: contract.project_id,
    title: contract.title,
    // 契约本身不携带「方向」字段，用标题占位（可读性优于留空）。
    direction: existing?.direction ?? contract.title,
    contract,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  store.projects.save(project);

  const report = buildReport(result, [result.finalScore]);
  const score: ScoreRecord = {
    id: options.id ?? randomUUID(),
    projectId: contract.project_id,
    finalScore: result.finalScore,
    sCore: result.sCore,
    dimensions: result.dimensions,
    gates: result.gates,
    stats: report.stats,
    // 仅在显式提供时写入 ladder 键，保持旧版记录的形状不变。
    ...(options.ladder !== undefined ? { ladder: options.ladder } : {}),
    createdAt: now,
  };
  store.scores.save(score);
  return score;
}

/** 历史查询报告。 */
export function historyCommand(storeDir: string, projectId?: string): string {
  const store = createJsonFilePersistence(storeDir);
  const scores = store.scores
    .list()
    .filter((s) => projectId === undefined || s.projectId === projectId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  if (scores.length === 0) {
    return `评分历史（${storeDir}）：无记录${projectId ? `（project=${projectId}）` : ""}`;
  }

  const projectTitle = new Map(store.projects.list().map((p) => [p.id, p.title]));
  const lines = [`评分历史（${storeDir}）：共 ${scores.length} 条`];
  for (const s of scores) {
    const title = projectTitle.get(s.projectId) ?? "（未知项目）";
    const d = s.dimensions;
    lines.push(
      `  ${s.createdAt}  ${s.finalScore.toString().padStart(5)} 分  [${s.projectId}] ${title}  ` +
        `outcome=${d.outcome.toFixed(2)} process=${d.process.toFixed(2)} semantic=${d.semantic.toFixed(2)} rubric=${d.rubric.toFixed(2)}`,
    );
  }
  return lines.join("\n");
}
