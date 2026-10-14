/**
 * 模型连接配置（供应商 / Base URL / 模型）。
 *
 * 与 API Key 分开存放：Key 走系统密钥库（keyring，见 lib/secret.ts），
 * 这里只放非敏感的连接参数，落在 localStorage。默认本地 Ollama（免 Key）。
 */
export type Provider = "ollama" | "openai" | "anthropic" | "custom";

export interface ConnectionConfig {
  provider: Provider;
  baseUrl: string;
  model: string;
}

const KEY = "ceg.connection";

export const PROVIDERS: Provider[] = ["ollama", "openai", "anthropic", "custom"];

export const DEFAULT_BASE_URL: Record<Provider, string> = {
  ollama: "http://127.0.0.1:11434",
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  custom: "",
};

export const DEFAULT_MODEL: Record<Provider, string> = {
  ollama: "qwen3:14b",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  custom: "",
};

/** 该供应商是否必须有 API Key（Ollama 本地免 Key）。 */
export function needsKey(p: Provider): boolean {
  return p !== "ollama";
}

export function loadConnection(): ConnectionConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const c = JSON.parse(raw) as Partial<ConnectionConfig>;
      if (c.provider && PROVIDERS.includes(c.provider)) {
        return {
          provider: c.provider,
          baseUrl: c.baseUrl ?? DEFAULT_BASE_URL[c.provider],
          model: c.model ?? DEFAULT_MODEL[c.provider],
        };
      }
    }
  } catch {
    /* ignore */
  }
  return { provider: "ollama", baseUrl: DEFAULT_BASE_URL.ollama, model: DEFAULT_MODEL.ollama };
}

export function saveConnection(c: ConnectionConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}
