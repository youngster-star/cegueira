/**
 * P5 数据存储位置与备份清单（PRD §3 系统集成）。
 */

export type Platform = "win32" | "darwin" | "linux";

export type EnvLike = Record<string, string | undefined>;

export interface BackupManifest {
  id: string;
  createdAt: string;
  files: string[];
  sizeBytes: number;
}
