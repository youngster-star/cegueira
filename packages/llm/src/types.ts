/**
 * LLM Provider 抽象层（PRD §7「BYO API Key」/ 开发文档 §9.6）。
 *
 * 设计目标：
 * 1. 统一 chat 能力抽象，供评分引擎（S_rubric 评审）、契约生成器调用；
 * 2. 默认走本地 Ollama（零 API Key、零下载），OpenAI/Anthropic 等云厂商
 *    接口预留（同一 LlmProvider 接口，仅实现不同）。
 * 3. 零第三方依赖：仅用全局 fetch（Node 18+ 与浏览器均内置）。
 */

/** 聊天消息。 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 聊天请求。 */
export interface ChatRequest {
  messages: ChatMessage[];
  /** 采样温度（默认由 provider 决定）。 */
  temperature?: number;
  /** 最大生成 token 数。 */
  maxTokens?: number;
  /** 是否要求返回 JSON（供结构化评审/生成用，provider 尽力保证）。 */
  jsonMode?: boolean;
}

/** 聊天响应。 */
export interface ChatResponse {
  content: string;
  model?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
  };
}

/** 统一 LLM Provider 接口。 */
export interface LlmProvider {
  /** provider 标识（如 "ollama" / "openai" / "anthropic"）。 */
  readonly id: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

/** 通用配置（各 provider 按需取用字段）。 */
export interface LlmConfig {
  /** 服务基地址，默认取决于 provider（Ollama 默认 http://127.0.0.1:11434）。 */
  baseUrl?: string;
  /** 模型名。 */
  model?: string;
  /** API Key（OpenAI/Anthropic 必需；Ollama 忽略）。 */
  apiKey?: string;
}
