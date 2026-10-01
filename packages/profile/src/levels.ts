/** 六档技能分档（PRD §5.1）。 */
export interface LevelDef {
  level: number;
  name: string;
  min: number;
  max: number;
}

export const LEVELS: readonly LevelDef[] = [
  { level: 1, name: "起步", min: 0.0, max: 2.0 },
  { level: 2, name: "基础", min: 2.0, max: 4.5 },
  { level: 3, name: "基本掌握", min: 4.5, max: 6.5 },
  { level: 4, name: "熟练", min: 6.5, max: 8.0 },
  { level: 5, name: "精通", min: 8.0, max: 9.0 },
  { level: 6, name: "大师", min: 9.0, max: 10.0 },
];

export const SCORE_MAX = 10.0;

/** 分数 → 档位（区间左闭右开，10.0 归入最后一档）。 */
export function levelOf(score: number): LevelDef {
  if (!Number.isFinite(score) || score < 0 || score > SCORE_MAX) {
    throw new RangeError(`score out of range: ${score}`);
  }
  if (score === SCORE_MAX) return LEVELS[LEVELS.length - 1];
  return LEVELS.find((l) => score >= l.min && score < l.max)!;
}
