/** 弱点严重度。 */
export type WeaknessSeverity = "high" | "medium" | "low";

export interface Finding {
  category: string;
  severity: WeaknessSeverity;
  line: number;
  message: string;
}

export interface SeverityCounts {
  high: number;
  medium: number;
  low: number;
  total: number;
}

export interface ScanReport {
  findings: Finding[];
  counts: SeverityCounts;
  /** 加权弱点计数：high=1 / medium=0.5 / low=0.2（ISO 5055 弱点计数的主信号）。 */
  weaknessScore: number;
}
