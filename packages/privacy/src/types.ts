/** 脱敏结果。 */
export interface RedactionResult {
  text: string;
  hitCount: number;
  hits: string[]; // 命中的脱敏类别（去重）
}

/** 外发用途：决定路由与预览文案（PRD §7）。 */
export type OutboundPurpose = "review" | "generation";

/** 外发预览：发送前展示给用户「发给谁、什么内容」。 */
export interface OutboundPreview {
  supplier: string;
  purpose: OutboundPurpose;
  content: string; // 已脱敏 + 裁剪后的内容
  charCount: number;
  tokenEstimate: number; // 粗略估算：charCount / 4
  summary: string;
}

/** 隐私流水线结果：脱敏 → 裁剪 → 预览。 */
export interface PrivacyResult {
  redacted: RedactionResult;
  pruned: string;
  preview: OutboundPreview;
}
