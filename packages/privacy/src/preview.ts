import type { OutboundPreview, OutboundPurpose } from "./types.js";
import { routeSupplier } from "./route.js";

function purposeLabel(purpose: OutboundPurpose): string {
  return purpose === "review" ? "评审" : "生成";
}

/** 构造外发预览：发给谁、什么内容、字符数、token 估算。 */
export function buildPreview(content: string, purpose: OutboundPurpose): OutboundPreview {
  const supplier = routeSupplier(purpose);
  return {
    supplier,
    purpose,
    content,
    charCount: content.length,
    tokenEstimate: Math.ceil(content.length / 4),
    summary: `将发送给 ${supplier}（用途：${purposeLabel(purpose)}），共 ${content.length} 字符`,
  };
}
