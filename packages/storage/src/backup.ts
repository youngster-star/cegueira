/**
 * 备份清单：记录一次备份的文件列表、体积与时间（PRD §3 备份恢复）。
 */
import type { BackupManifest } from "./types.js";

export function createBackupManifest(
  id: string,
  files: string[],
  sizeBytes: number,
  createdAt = new Date().toISOString(),
): BackupManifest {
  return { id, createdAt, files: [...files], sizeBytes };
}

/** 体积格式化：字节 → 人类可读（KB/MB）。 */
export function formatBytes(bytes: number): string {
  // 非有限数（NaN/Infinity）或负数在体积语义下无意义，归零防御
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** 清单摘要（供日志/展示）。 */
export function manifestSummary(m: BackupManifest): string {
  return `#${m.id} @ ${m.createdAt} · ${m.files.length} files · ${formatBytes(m.sizeBytes)}`;
}
