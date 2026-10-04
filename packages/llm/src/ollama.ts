/**
 * Ollama 本地 provider（默认，零 API Key）。
 * 调 /api/chat，走全局 fetch。
 */
import type {
  ChatRequest,
  ChatResponse,
  LlmConfig,
  LlmProvider,
} from "./types.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen3:14b";

export function createOllamaProvider(config: LlmConfig = {}): LlmProvider {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = config.model ?? DEFAULT_MODEL;

  return {
    id: "ollama",
    async chat(req: ChatRequest): Promise<ChatResponse> {
      const body: Record<string, unknown> = {
        model,
        messages: req.messages,
        stream: false,
      };
      if (req.jsonMode) body.format = "json";
      const options: Record<string, unknown> = {};
      if (req.temperature !== undefined) options.temperature = req.temperature;
      if (req.maxTokens !== undefined) options.num_predict = req.maxTokens;
      if (Object.keys(options).length > 0) body.options = options;

      let res: Response;
      try {
        res = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (e) {
        throw new Error(
          `[ollama] 无法连接 ${baseUrl}（请确认 Ollama 服务已启动）: ${(e as Error).message}`,
        );
      }
      if (!res.ok) {
        throw new Error(`[ollama] /api/chat 失败 HTTP ${res.status}: ${await res.text()}`);
      }
      const data = (await res.json()) as {
        message?: { content?: string };
        model?: string;
        prompt_eval_count?: number;
        eval_count?: number;
      };
      return {
        content: data.message?.content ?? "",
        model: data.model,
        usage: {
          promptTokens: data.prompt_eval_count,
          completionTokens: data.eval_count,
        },
      };
    },
  };
}
