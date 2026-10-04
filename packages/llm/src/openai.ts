/**
 * OpenAI 兼容 provider（接口预留）。
 * 调 /v1/chat/completions，需 apiKey。
 */
import type {
  ChatRequest,
  ChatResponse,
  LlmConfig,
  LlmProvider,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.openai.com";

export function createOpenAIProvider(config: LlmConfig): LlmProvider {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = config.model ?? "gpt-4o-mini";
  const apiKey = config.apiKey;

  return {
    id: "openai",
    async chat(req: ChatRequest): Promise<ChatResponse> {
      if (!apiKey) throw new Error("[openai] 缺少 apiKey");
      const body: Record<string, unknown> = {
        model,
        messages: req.messages,
      };
      if (req.temperature !== undefined) body.temperature = req.temperature;
      if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
      if (req.jsonMode) body.response_format = { type: "json_object" };

      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`[openai] 请求失败 HTTP ${res.status}: ${await res.text()}`);
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      return {
        content: data.choices?.[0]?.message?.content ?? "",
        model: data.model,
        usage: {
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
        },
      };
    },
  };
}
