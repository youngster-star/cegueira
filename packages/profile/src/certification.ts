/**
 * 顶级档双轨制认证（PRD §5.5）。
 *
 * 「分数达标只是必要条件，还需产出认证」：
 *
 * - 精通（档 5，≥8.0）：完成 ≥2 个「难度 ≥8.0 且他人可复现」的项目；
 * - 大师（档 6，≥9.0）：≥1 个项目「被他人实际采用，或方案被社区采纳」。
 *
 * 项目难度（0–10）属 PRD §5.7 的**独立标尺**，与用户能力分不可互推——因此本模块
 * 只接受调用方提供的证据（`ProjectEvidence`），**绝不由分数反推难度**。证据应由
 * 用户/社区如实提供；本地无法校验「他人是否真的复现/采用」，故只做门槛判定。
 */

/** 单个项目的认证证据。 */
export interface ProjectEvidence {
  projectId: string;
  /** 项目难度（0–10，§5.7 标尺）。低于 {@link HARD_DIFFICULTY} 不计入精通认证。 */
  difficulty: number;
  /** 是否「他人可复现」（环境/步骤说明齐全且已被复现）。 */
  reproducible: boolean;
  /** 是否「被他人实际采用，或方案被社区采纳」。 */
  adopted: boolean;
}

/** 认证判定结果（持久化结构兼容，见 @cegueira/persistence 的 ProfileRecord.certification）。 */
export interface CertificationResult {
  /** 最高档是否达到精通档（≥5）并通过认证。 */
  level5: boolean;
  /** 最高档是否达到大师档（≥6）并通过认证。 */
  level6: boolean;
  /** 满足「难度 ≥8.0 且可复现」的项目数。 */
  hardReproducibleProjects: number;
  /** 「被采用」的项目数。 */
  adoptedProjects: number;
}

/** 计入精通认证的难度门槛。 */
export const HARD_DIFFICULTY = 8.0;
/** 精通认证所需的「高难且可复现」项目数。 */
export const LEVEL5_MIN_PROJECTS = 2;
/** 大师认证所需的「被采用」项目数。 */
export const LEVEL6_MIN_PROJECTS = 1;

/**
 * 以「最高档位」与「项目证据」判定顶级档认证。
 *
 * `level` 应为画像中的最高档位（0 表示无任何评估）——档位已隐含分数门槛
 * （档 5 ⇔ 分数 ≥8.0，档 6 ⇔ ≥9.0，见 levels.ts）。
 */
export function evaluateCertification(
  level: number,
  evidence: ProjectEvidence[],
): CertificationResult {
  const hardReproducibleProjects = evidence.filter(
    (e) => e.difficulty >= HARD_DIFFICULTY && e.reproducible,
  ).length;
  const adoptedProjects = evidence.filter((e) => e.adopted).length;
  return {
    level5: level >= 5 && hardReproducibleProjects >= LEVEL5_MIN_PROJECTS,
    level6: level >= 6 && adoptedProjects >= LEVEL6_MIN_PROJECTS,
    hardReproducibleProjects,
    adoptedProjects,
  };
}
