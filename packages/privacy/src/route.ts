import type { OutboundPurpose } from "./types.js";

/**
 * 按用途路由到不同供应商（PRD §7「路由」）。
 * 评审类与生成类走不同模型，避免单一供应商集中。
 */
const ROUTE_MAP: Record<OutboundPurpose, string> = {
  review: "anthropic-review",
  generation: "openai-generation",
};

export function routeSupplier(purpose: OutboundPurpose): string {
  return ROUTE_MAP[purpose];
}
