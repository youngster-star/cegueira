import { test } from "node:test";
import assert from "node:assert";
import {
  createAnthropicProvider,
  createOllamaProvider,
  createOpenAIProvider,
  type LlmProvider,
} from "./index.js";

const origFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    return handler(String(url), init ?? {});
  }) as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = origFetch;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("LlmProvider 抽象：mock provider 满足接口", async () => {
  const p: LlmProvider = {
    id: "mock",
    async chat(req) {
      return { content: `echo:${req.messages.at(-1)?.content}` };
    },
  };
  assert.equal(p.id, "mock");
  const r = await p.chat({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(r.content, "echo:hi");
});

test("ollama：请求体构造正确（model/messages/stream=false）", async () => {
  let captured!: { url: string; body: Record<string, unknown> };
  mockFetch((url, init) => {
    captured = { url, body: JSON.parse(init.body as string) };
    return jsonResponse({ message: { role: "assistant", content: "ok" }, model: "qwen3:14b" });
  });
  try {
    const p = createOllamaProvider({ model: "qwen3:14b" });
    const r = await p.chat({ messages: [{ role: "user", content: "你好" }] });
    assert.equal(captured.url, "http://127.0.0.1:11434/api/chat");
    assert.equal(captured.body.model, "qwen3:14b");
    assert.equal(captured.body.stream, false);
    assert.deepEqual(captured.body.messages, [{ role: "user", content: "你好" }]);
    assert.equal(r.content, "ok");
    assert.equal(r.model, "qwen3:14b");
  } finally {
    restoreFetch();
  }
});

test("ollama：jsonMode 设置 format=json", async () => {
  let captured!: { body: Record<string, unknown> };
  mockFetch((_url, init) => {
    captured = { body: JSON.parse(init.body as string) };
    return jsonResponse({ message: { content: '{"score":0.8}' } });
  });
  try {
    const p = createOllamaProvider();
    await p.chat({ messages: [{ role: "user", content: "x" }], jsonMode: true });
    assert.equal(captured.body.format, "json");
  } finally {
    restoreFetch();
  }
});

test("ollama：连接失败抛出可读错误", async () => {
  mockFetch(() => {
    throw new Error("ECONNREFUSED");
  });
  try {
    const p = createOllamaProvider();
    await assert.rejects(
      () => p.chat({ messages: [{ role: "user", content: "x" }] }),
      /无法连接.*Ollama 服务已启动/,
    );
  } finally {
    restoreFetch();
  }
});

test("openai：携带 authorization 头 + 解析 choices", async () => {
  let captured!: { url: string; headers: Headers; body: Record<string, unknown> };
  mockFetch((url, init) => {
    captured = { url, headers: new Headers(init.headers as HeadersInit), body: JSON.parse(init.body as string) };
    return jsonResponse({
      choices: [{ message: { content: "hi" } }],
      model: "gpt-4o-mini",
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    });
  });
  try {
    const p = createOpenAIProvider({ apiKey: "sk-test", model: "gpt-4o-mini" });
    const r = await p.chat({ messages: [{ role: "user", content: "x" }] });
    assert.equal(captured.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(captured.headers.get("authorization"), "Bearer sk-test");
    assert.equal(r.content, "hi");
    assert.equal(r.usage?.promptTokens, 5);
  } finally {
    restoreFetch();
  }
});

test("openai：缺少 apiKey 抛错", async () => {
  const p = createOpenAIProvider({ model: "gpt-4o-mini" });
  await assert.rejects(
    () => p.chat({ messages: [{ role: "user", content: "x" }] }),
    /缺少 apiKey/,
  );
});

test("anthropic：system 拆分为独立字段 + x-api-key 头", async () => {
  let captured!: { headers: Headers; body: Record<string, unknown> };
  mockFetch((_url, init) => {
    captured = { headers: new Headers(init.headers as HeadersInit), body: JSON.parse(init.body as string) };
    return jsonResponse({
      content: [{ type: "text", text: "answer" }],
      model: "claude-3-5-haiku-latest",
      usage: { input_tokens: 3, output_tokens: 4 },
    });
  });
  try {
    const p = createAnthropicProvider({ apiKey: "sk-ant", model: "claude-3-5-haiku-latest" });
    const r = await p.chat({
      messages: [
        { role: "system", content: "你是评审" },
        { role: "user", content: "打分" },
      ],
    });
    assert.equal(captured.headers.get("x-api-key"), "sk-ant");
    assert.equal(captured.headers.get("anthropic-version"), "2023-06-01");
    assert.equal(captured.body.system, "你是评审");
    assert.deepEqual(captured.body.messages, [{ role: "user", content: "打分" }]);
    assert.equal(r.content, "answer");
    assert.equal(r.usage?.completionTokens, 4);
  } finally {
    restoreFetch();
  }
});
