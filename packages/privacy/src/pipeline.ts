import { redact } from "./redact.js";
import { pruneAst } from "./astPrune.js";
import { buildPreview } from "./preview.js";
import type { OutboundPurpose, PrivacyResult } from "./types.js";

/**
 * 隐私流水线：本地脱敏 → AST 裁剪 → 外发预览。
 * 外发预览是强制步骤——发送前必须让用户确认「发给谁、什么内容」。
 */
export function processPrivacy(text: string, purpose: OutboundPurpose): PrivacyResult {
  const redacted = redact(text);
  const pruned = pruneAst(redacted.text);
  const preview = buildPreview(pruned, purpose);
  return { redacted, pruned, preview };
}
