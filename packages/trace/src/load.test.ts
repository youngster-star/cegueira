import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  parseHttpYaml,
  parseRecording,
  parseResultLine,
  parseToolIoLog,
  parseTraceJson,
  RecordingFormatError,
  type RecordingFiles,
} from "./load.js";

// ---------------------------------------------------------------------------
// 构造样本产物。刻意与 python/replay/session.py 的写出格式逐字对齐——
// 这里写错的话，测试会绿而真实录制会炸。
// ---------------------------------------------------------------------------

/** 生成一份 http.yaml。records 以「指纹 → 条目」给出，顺序即传入顺序。 */
function httpYaml(records: Record<string, { host?: string; status?: number }>): string {
  const lines = ["schema: '1.0'", "records:"];
  for (const [fp, r] of Object.entries(records)) {
    lines.push(`  ${fp}:`);
    lines.push("    request:");
    lines.push("      method: POST");
    if (r.host !== undefined) lines.push(`      host: ${r.host}`);
    lines.push("      path: /v1/chat/completions");
    lines.push(`      body: '{"n": ${fp}}'`);
    lines.push("    response:");
    lines.push(`      status: ${r.status ?? 200}`);
    lines.push(`      body: '{"ok": true}'`);
  }
  return lines.join("\n") + "\n";
}

/** 生成一份 trace.json。 */
function traceJson(spans: unknown[]): string {
  return JSON.stringify({ schema: "1.0", run_id: "run-1", spans }, null, 2);
}

/** 生成一份 tool_io.log（JSON Lines）。传入字符串则原样使用，便于造坏行。 */
function toolIoLog(records: (unknown | string)[]): string {
  return records.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n";
}

const TOOL_1 = { tool: "retrieve", input: { query: "rag" }, output: ["d1", "d2"], ok: true, latency_ms: 12.5 };
const TOOL_2 = { tool: "generate", input: { prompt: "p" }, output: "answer", ok: true, latency_ms: 30 };
const RETRIEVAL_SPAN = {
  id: "span-1",
  parent_id: null,
  name: "retrieve",
  kind: "RETRIEVAL",
  start_ms: 0,
  duration_ms: 12.5,
  attributes: { query: "rag", returned_doc_ids: ["d1", "d2"] },
};
const LLM_SPAN = {
  id: "span-2",
  parent_id: null,
  name: "chat",
  kind: "LLM",
  start_ms: 20,
  duration_ms: 800,
  attributes: { prompt_tokens: 100, completion_tokens: 20 },
};

/** 一份「看起来正常」的完整录制。 */
function goodFiles(overrides: Partial<RecordingFiles> = {}): RecordingFiles {
  return {
    http: httpYaml({ f2: {}, f1: {} }),
    trace: traceJson([RETRIEVAL_SPAN, LLM_SPAN]),
    toolIo: toolIoLog([TOOL_1, TOOL_2]),
    ...overrides,
  };
}

/** 断言解析抛 RecordingFormatError，返回错误消息。 */
function reject(fn: () => unknown, file: string): string {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof RecordingFormatError, `期望 RecordingFormatError，实际 ${e}`);
    assert.ok(e.message.startsWith(`${file}:`), `错误消息应以文件名开头，实际：${e.message}`);
    return e.message;
  }
  assert.fail("期望抛错，实际成功返回");
}

// ---- http.yaml ----

test("parseHttpYaml：records 字典 → 按指纹排序的数组", () => {
  const out = parseHttpYaml(httpYaml({ f2: {}, f1: {} }));
  // 输入顺序是 f2, f1；输出必须按指纹升序，与插入顺序无关
  assert.deepEqual(out.map((e) => e.fingerprint), ["f1", "f2"]);
  assert.equal(out[0].request.method, "POST");
  assert.equal(out[0].request.path, "/v1/chat/completions");
  assert.equal(out[0].response.status, 200);
  assert.equal(out[0].request.host, undefined, "host 缺省时不应编造");
});

test("parseHttpYaml：host 存在时保留（旧版扁平录制没有 host）", () => {
  const out = parseHttpYaml(httpYaml({ f1: { host: "api.openai.com" } }));
  assert.equal(out[0].request.host, "api.openai.com");
});

test("parseHttpYaml：空 records 得空数组", () => {
  assert.deepEqual(parseHttpYaml("schema: '1.0'\nrecords: {}\n"), []);
});

test("parseHttpYaml：非 YAML 与非对象顶层都报错", () => {
  assert.match(reject(() => parseHttpYaml("["), "http.yaml"), /YAML 解析失败/);
  assert.match(reject(() => parseHttpYaml("- 1\n- 2\n"), "http.yaml"), /顶层 应为对象/);
  assert.match(reject(() => parseHttpYaml("schema: '1.0'\n"), "http.yaml"), /records 字段 应为对象/);
});

test("parseHttpYaml：条目缺字段时报出指纹与字段名", () => {
  const broken = httpYaml({ f1: {} }).replace("      status: 200\n", "");
  assert.match(reject(() => parseHttpYaml(broken), "http.yaml"), /records\[f1\]\.response\.status 应为有限数字/);
});

// ---- trace.json ----

test("parseTraceJson：LLM 与 RETRIEVAL span 分派到两个数组", () => {
  const out = parseTraceJson(traceJson([RETRIEVAL_SPAN, LLM_SPAN]));
  assert.deepEqual(out.llmSpans, [{ id: "span-2", promptTokens: 100, completionTokens: 20, latencyMs: 800 }]);
  assert.deepEqual(out.retrievals, [{ id: "span-1", query: "rag", returnedDocIds: ["d1", "d2"] }]);
  assert.equal(out.ignoredSpans, 0);
});

test("parseTraceJson：RETRIEVAL 可选 returned_docs → returnedDocs（缺省不加键）", () => {
  const withDocs = {
    ...RETRIEVAL_SPAN,
    attributes: {
      query: "rag",
      returned_doc_ids: ["d1"],
      returned_docs: [{ id: "d1", text: "检索增强生成" }],
    },
  };
  const out = parseTraceJson(traceJson([withDocs]));
  assert.deepEqual(out.retrievals, [
    {
      id: "span-1",
      query: "rag",
      returnedDocIds: ["d1"],
      returnedDocs: [{ id: "d1", text: "检索增强生成" }],
    },
  ]);
  // 无 returned_docs 时不出现该键
  const plain = parseTraceJson(traceJson([RETRIEVAL_SPAN]));
  assert.equal("returnedDocs" in plain.retrievals[0], false);
});

test("parseTraceJson：returned_docs 元素缺 text 时报错定位", () => {
  const bad = {
    ...RETRIEVAL_SPAN,
    attributes: { query: "q", returned_doc_ids: ["d1"], returned_docs: [{ id: "d1" }] },
  };
  assert.match(
    reject(() => parseTraceJson(traceJson([bad])), "trace.json"),
    /returned_docs\[0\]\.text 应为字符串/,
  );
});

test("parseTraceJson：kind 大小写不敏感", () => {
  const lower = { ...LLM_SPAN, kind: "llm" };
  const out = parseTraceJson(traceJson([lower]));
  assert.equal(out.llmSpans.length, 1);
});

test("parseTraceJson：结构性 span 被有意跳过并计数", () => {
  const spans = [
    { ...LLM_SPAN, id: "s1", kind: "CHAIN" },
    { ...LLM_SPAN, id: "s2", kind: "TOOL" },
    { ...LLM_SPAN, id: "s3", kind: "AGENT" },
    { ...LLM_SPAN, id: "s4", kind: "INTERNAL" },
    LLM_SPAN,
  ];
  const out = parseTraceJson(traceJson(spans));
  assert.equal(out.ignoredSpans, 4);
  assert.equal(out.llmSpans.length, 1);
});

test("parseTraceJson：未知 kind 必须报错，不能静默跳过", () => {
  // 静默跳过的后果：埋点写错（RETRIVAL 少个 E）会表现成「这个 Agent 没检索」
  const typo = { ...RETRIEVAL_SPAN, kind: "RETRIVAL" };
  assert.match(reject(() => parseTraceJson(traceJson([typo])), "trace.json"), /未知的 "RETRIVAL"/);
});

test("parseTraceJson：token 用量缺失记 0（表示未知，不参与评分门控）", () => {
  const noTokens = { ...LLM_SPAN, attributes: {} };
  const out = parseTraceJson(traceJson([noTokens]));
  assert.equal(out.llmSpans[0].promptTokens, 0);
  assert.equal(out.llmSpans[0].completionTokens, 0);
});

test("parseTraceJson：RETRIEVAL span 缺 query 或 returned_doc_ids 都报错", () => {
  const noQuery = { ...RETRIEVAL_SPAN, attributes: { returned_doc_ids: ["d1"] } };
  assert.match(reject(() => parseTraceJson(traceJson([noQuery])), "trace.json"), /缺 query/);

  const noDocs = { ...RETRIEVAL_SPAN, attributes: { query: "rag" } };
  assert.match(reject(() => parseTraceJson(traceJson([noDocs])), "trace.json"), /缺 returned_doc_ids/);
});

test("parseTraceJson：坏 JSON、缺 spans、duration 非数字都报错", () => {
  assert.match(reject(() => parseTraceJson("{"), "trace.json"), /JSON 解析失败/);
  assert.match(reject(() => parseTraceJson("{}"), "trace.json"), /spans 字段 应为数组/);
  const noDuration = { ...LLM_SPAN, duration_ms: null };
  assert.match(reject(() => parseTraceJson(traceJson([noDuration])), "trace.json"), /duration_ms 应为有限数字/);
});

// ---- tool_io.log ----

test("parseToolIoLog：逐行解析，id 按行序生成", () => {
  const out = parseToolIoLog(toolIoLog([TOOL_1, TOOL_2]));
  assert.deepEqual(out, [
    { id: "tool-1", name: "retrieve", args: { query: "rag" }, result: ["d1", "d2"], ok: true, latencyMs: 12.5 },
    { id: "tool-2", name: "generate", args: { prompt: "p" }, result: "answer", ok: true, latencyMs: 30 },
  ]);
});

test("parseToolIoLog：空文件与尾部空行都得空数组", () => {
  assert.deepEqual(parseToolIoLog(""), []);
  assert.deepEqual(parseToolIoLog("\n"), []);
  assert.deepEqual(parseToolIoLog("\n\n"), []);
  assert.equal(parseToolIoLog(toolIoLog([TOOL_1])).length, 1);
});

test("parseToolIoLog：坏行报错并给出**行号**，绝不跳过", () => {
  // 跳过的后果：工具调用凭空少一条，而 S_process 的步数/冗余率/成功率全建立在这个数组上
  const text = toolIoLog([TOOL_1, "{不是 JSON", TOOL_2]);
  assert.match(reject(() => parseToolIoLog(text), "tool_io.log"), /第 2 行不是合法 JSON/);
});

test("parseToolIoLog：字段类型不符时报出行号与字段名", () => {
  const bad = toolIoLog([{ ...TOOL_1, ok: "yes" }]);
  assert.match(reject(() => parseToolIoLog(bad), "tool_io.log"), /第 1 行\.ok 应为布尔值/);
});

test("parseToolIoLog：外部依赖调用（source=dep）不进 tools", () => {
  // 计量单位不对：一次 retrieve() 内部可能打 3 个外部调用，用户眼里那是一步。
  // 混进来还会让契约里的 tool_call_in 白名单永远匹配不到 db.execute（恒假）。
  const text = toolIoLog([
    TOOL_1,
    { tool: "db.execute", input: { sql: "SELECT 1" }, output: { row_count: 1 }, ok: true, latency_ms: 1, source: "dep" },
    TOOL_2,
    { tool: "http.fetch", input: { url: "http://x" }, output: "{}", ok: true, latency_ms: 2, source: "dep" },
  ]);
  const out = parseToolIoLog(text);
  assert.deepEqual(out.map((t) => t.name), ["retrieve", "generate"]);
  // id 按**过滤后**的序号，不是原行号
  assert.deepEqual(out.map((t) => t.id), ["tool-1", "tool-2"]);
});

test("parseToolIoLog：旧版产物没有 source 字段时按 Agent 工具处理", () => {
  assert.deepEqual(parseToolIoLog(toolIoLog([TOOL_1])).map((t) => t.name), ["retrieve"]);
});

test("parseToolIoLog：未知 source 报错，不静默当成 agent", () => {
  const bad = toolIoLog([{ ...TOOL_1, source: "external" }]);
  assert.match(reject(() => parseToolIoLog(bad), "tool_io.log"), /source 为未知值 "external"/);
});

// ---- result（Agent 的 stdout trace 行） ----

test("parseResultLine：有 final_answer 时产出 finalAnswer", () => {
  const line = JSON.stringify({
    type: "trace",
    final_answer: { text: "RAG 是检索增强生成 [d1]", cited_doc_ids: ["d1"] },
  });
  assert.deepEqual(parseResultLine(line), { text: "RAG 是检索增强生成 [d1]", citedDocIds: ["d1"] });
});

test("parseResultLine：没有 final_answer 时返回 undefined，不编造空答案", () => {
  // 编造空答案会让 answer_has_citation 恒假、cited ⊆ retrieval 恒真（空集是子集），两者都误导评分
  assert.equal(parseResultLine(JSON.stringify({ type: "trace", answer: "x" })), undefined);
  assert.equal(parseResultLine(""), undefined);
  assert.equal(parseResultLine("   \n"), undefined);
});

test("parseResultLine：引用列表缺失视为空数组，不是 undefined", () => {
  const line = JSON.stringify({ type: "trace", final_answer: { text: "无引用" } });
  assert.deepEqual(parseResultLine(line), { text: "无引用", citedDocIds: [] });
});

// ---- 入口 ----

test("parseRecording：三件套组装成 AgentTrace", () => {
  const trace = parseRecording(goodFiles());
  assert.equal(trace.http.length, 2);
  assert.equal(trace.tools.length, 2);
  assert.equal(trace.llmSpans.length, 1);
  assert.equal(trace.retrievals.length, 1);
  assert.equal(trace.finalAnswer, undefined, "未提供 result 时无 finalAnswer");
});

test("parseRecording：给了 result 才有 finalAnswer", () => {
  const line = JSON.stringify({ type: "trace", final_answer: { text: "答案 [d1]", cited_doc_ids: ["d1"] } });
  const trace = parseRecording(goodFiles({ result: line }));
  assert.deepEqual(trace.finalAnswer, { text: "答案 [d1]", citedDocIds: ["d1"] });
});

test("parseRecording：是纯函数——两次解析深度相等", () => {
  // 「录一次、评两次、结果完全一致」的前提；任何时间戳或对象键顺序依赖都会破坏它
  assert.deepEqual(parseRecording(goodFiles()), parseRecording(goodFiles()));
});

test("parseRecording：产物里哪个文件坏了，错误消息就点名哪个文件", () => {
  assert.match(reject(() => parseRecording(goodFiles({ http: "[" })), "http.yaml"), /YAML 解析失败/);
  assert.match(reject(() => parseRecording(goodFiles({ trace: "{" })), "trace.json"), /JSON 解析失败/);
  assert.match(reject(() => parseRecording(goodFiles({ toolIo: "oops" })), "tool_io.log"), /不是合法 JSON/);
});
