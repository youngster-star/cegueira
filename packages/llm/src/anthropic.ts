/**
 * Anthropic provider（接口预留）。
 * 调 /v1/messages，需 apiKey + anthropic-version 头。
 */
import type {
  ChatRequest,
  ChatResponse,
  LlmConfig,
  LlmProvider,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

export function createAnthropicProvider(config: LlmConfig): LlmProvider {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = config.model ?? "claude-3-5-haiku-latest";
  const apiKey = config.apiKey;

  return {
    id: "anthropic",
    async chat(req: ChatRequest): Promise<ChatResponse> {
      if (!apiKey) throw new Error("[anthropic] 缺少 apiKey");
      // 拆出 system 消息（Anthropic 的 system 是独立字段）
      const system = req.messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n");
      const messages = req.messages.filter((m) => m.role !== "system");

      const body: Record<string, unknown> = {
        model,
        max_tokens: req.maxTokens ?? 1024,
        messages,
      };
      if (system) body.system = system;
      if (req.temperature !== undefined) body.temperature = req.temperature;

      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`[anthropic] 请求失败 HTTP ${res.status}: ${await res.text()}`);
      }
      const data = (await res.json()) as {
        content?: { type: string; text?: string }[];
        model?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = (data.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("");
      return {
        content: text,
        model: data.model,
        usage: {
          promptTokens: data.usage?.input_tokens,
          completionTokens: data.usage?.output_tokens,
        },
      };
    },
  };
}
