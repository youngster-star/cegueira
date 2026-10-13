/**
 * 录制产物加载器（A2）。
 *
 * 把 Python 侧写出的录制三件套解析为 `AgentTrace`，供指标计算、S_process
 * 与四道防作弊消费（A1 的 S_outcome 亦然）。
 *
 * ## 为什么是纯函数
 *
 * **WebView 里没有 `node:fs`**。桌面端的文件读取走 Rust 命令，因此本模块
 * 只吃字符串、吐对象——Node 与浏览器通用。CLI 侧自行 `readFileSync` 后调用。
 *
 * ## 为什么单独一个入口（`@cegueira/trace/load`）
 *
 * 本模块 import `yaml`，而 `yaml` 没有声明 `sideEffects: false`，打包器
 * 不敢摇树。若把它并进 `index.ts`，桌面端 WebView 的包里会平白多出一个
 * YAML 解析器。子路径导出让两条路径彻底分开：
 *
 *   - `@cegueira/trace`      → 纯类型 + 指标 + 求值器，零依赖，WebView 用
 *   - `@cegueira/trace/load` → 需要 `yaml`，只有 CLI 与测试用
 *
 * ## 与 manifest.json 的关系
 *
 * Python CLI 在录制目录里额外写一份 `manifest.json`，其 `trace` 字段**已经是
 * 本模块应当产出的形状**。两份实现（Python 组装 / TS 解析）必须一致，否则
 * 就是「两种真相」。`tests/test_manifest.py` 里的往返断言把漂移变成可检测的
 * 测试失败——这正是本仓「未命中一律报错，绝不降级」的同一原则。
 *
 * ## 已知边界（如实标注，不假装已解决）
 *
 * - **`final_answer` 是 Agent 自报的**。引用的文档 id 只能来自 Agent 自己的
 *   声明，没有别的来源。防伪造靠契约里的 `cited_doc_ids ⊆ retrieval_doc_ids`
 *   断言：引用的每个 id 都必须真实出现在检索结果中。要做答案文本级核对需要
 *   解析引用语法，而各 Agent 的引用写法不统一，不在本轮范围。
 * - **`prompt_tokens` / `completion_tokens` 缺失时记 0**。span 未声明 token
 *   用量时无法凭空推断，0 是「未知」而非「零消耗」。该值不参与任何评分门控，
 *   只用于展示，故不做更强的处理。
 */
import { parse as parseYaml } from "yaml";
import type {
  AgentTrace,
  FinalAnswer,
  HttpExchange,
  LlmSpan,
  RetrievalCall,
  ToolCall,
} from "./types.js";

/** 录制三件套的原文。`result` 可选，见 `parseRecording` 的说明。 */
export interface RecordingFiles {
  /** `http.yaml` 全文。 */
  http: string;
  /** `trace.json` 全文。 */
  trace: string;
  /** `tool_io.log` 全文（JSON Lines）。 */
  toolIo: string;
  /**
   * Agent 输出到 stdout 的那一行 `{"type":"trace", ...}` 的全文。
   *
   * 这是 `finalAnswer` 的唯一来源——三件套里都没有它。CLI 抓到后写入录制目录。
   * 缺失时 `AgentTrace.finalAnswer` 为 `undefined`，而非编造一个空答案。
   */
  result?: string;
}

/**
 * 录制产物格式错误。
 *
 * 用独立类型而非裸 `Error`，便于 CLI 区分「产物读不了」（用户该重新录制）
 * 与「评分逻辑出错」（我们的 bug）——两者的处置完全不同。
 */
export class RecordingFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingFormatError";
  }
}

/** 构造带文件名前缀的错误。所有格式错误都必须说清是哪个文件、哪一行。 */
function fail(file: string, detail: string): never {
  throw new RecordingFormatError(`${file}: ${detail}`);
}

// ---------------------------------------------------------------------------
// 取值助手：每个都要求类型严格匹配，不做隐式转换
// ---------------------------------------------------------------------------

function asObject(v: unknown, file: string, what: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    fail(file, `${what} 应为对象，实际 ${describe(v)}`);
  }
  return v as Record<string, unknown>;
}

function asArray(v: unknown, file: string, what: string): unknown[] {
  if (!Array.isArray(v)) fail(file, `${what} 应为数组，实际 ${describe(v)}`);
  return v;
}

function asString(v: unknown, file: string, what: string): string {
  if (typeof v !== "string") fail(file, `${what} 应为字符串，实际 ${describe(v)}`);
  return v;
}

function asNumber(v: unknown, file: string, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    fail(file, `${what} 应为有限数字，实际 ${describe(v)}`);
  }
  return v;
}

function asBoolean(v: unknown, file: string, what: string): boolean {
  if (typeof v !== "boolean") fail(file, `${what} 应为布尔值，实际 ${describe(v)}`);
  return v;
}

function asStringArray(v: unknown, file: string, what: string): string[] {
  const arr = asArray(v, file, what);
  return arr.map((x, i) => asString(x, file, `${what}[${i}]`));
}

/** 缺失字段的容错读取：undefined 与 null 都归为「没有」。 */
function optional(v: unknown): unknown {
  return v === undefined || v === null ? undefined : v;
}

/** 类型描述，用于报错信息。 */
function describe(v: unknown): string {
  if (v === undefined) return "缺失";
  if (v === null) return "null";
  if (Array.isArray(v)) return `数组(${v.length})`;
  return typeof v;
}

// ---------------------------------------------------------------------------
// http.yaml
// ---------------------------------------------------------------------------

/**
 * `http.yaml` → `HttpExchange[]`。
 *
 * 原文结构（python/replay/session.py `write_http_yaml`）：
 * ```yaml
 * schema: "1.0"
 * records:
 *   <fingerprint>:
 *     request: { method, host, path, body }
 *     response: { status, body }
 * ```
 *
 * 输出**按 fingerprint 排序**而非依赖对象键顺序——JS 对象键顺序对数字形状的
 * 键有特殊规则，排序才是确定的。评分要求「两次结果完全一致」，任何依赖插入
 * 顺序的写法都是隐患。
 */
export function parseHttpYaml(text: string): HttpExchange[] {
  const file = "http.yaml";

  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    fail(file, `YAML 解析失败：${e instanceof Error ? e.message : String(e)}`);
  }

  const root = asObject(raw, file, "顶层");
  const records = asObject(root["records"], file, "records 字段");

  const out: HttpExchange[] = [];
  for (const [fp, entry] of Object.entries(records)) {
    const rec = asObject(entry, file, `records[${fp}]`);
    const request = asObject(rec["request"], file, `records[${fp}].request`);
    const response = asObject(rec["response"], file, `records[${fp}].response`);

    const host = optional(request["host"]);
    out.push({
      fingerprint: fp,
      request: {
        method: asString(request["method"], file, `records[${fp}].request.method`),
        path: asString(request["path"], file, `records[${fp}].request.path`),
        body: asString(request["body"], file, `records[${fp}].request.body`),
        // 旧版扁平录制没有 host，此处如实留空而不是编一个占位值。
        ...(host === undefined
          ? {}
          : { host: asString(host, file, `records[${fp}].request.host`) }),
      },
      response: {
        status: asNumber(response["status"], file, `records[${fp}].response.status`),
        body: asString(response["body"], file, `records[${fp}].response.body`),
      },
    });
  }

  return out.sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0));
}

// ---------------------------------------------------------------------------
// trace.json
// ---------------------------------------------------------------------------

/**
 * 需要映射为轨迹数据的 span kind。
 *
 * `TOOL` / `CHAIN` / `AGENT` / `INTERNAL` 是**结构性子 span**：工具调用的参数与
 * 返回值来自 `tool_io.log`（更完整、且是回放匹配的依据），span 上只有时延。
 * 因此这四类被跳过——是「已知且有意忽略」，与「不认识的 kind」不是一回事。
 */
const MAPPED_KINDS = new Set(["LLM", "RETRIEVAL"]);
const IGNORED_KINDS = new Set(["TOOL", "CHAIN", "AGENT", "INTERNAL"]);

/** `trace.json` 的解析结果：LLM span 与检索调用分列。 */
export interface ParsedSpans {
  llmSpans: LlmSpan[];
  retrievals: RetrievalCall[];
  /** 被跳过的结构性 span 数，供 doctor/报告说明「不是所有 span 都进了评分」。 */
  ignoredSpans: number;
}

/**
 * `trace.json` → LLM span + 检索调用。
 *
 * 原文结构（python/replay/session.py `write_trace_json`）：
 * ```json
 * { "schema": "1.0", "run_id": "...",
 *   "spans": [ { "id", "parent_id", "name", "kind", "start_ms", "duration_ms", "attributes" } ] }
 * ```
 *
 * 注意与 `python/otel/span.py` 的 `Span.to_dict()` 形状不同（那边是
 * `span_id`/`start_ns`/`end_ns`）。**本加载器只吃 `RecordingSession` 写出的形状**
 * ——原因是脚手架走的是 `TraceCollector` → `RecordingSession.add_span` 这条线，
 * 落盘的已经是统一后的形状。两套形状并存是既成事实，转换点收敛在 add_span。
 */
export function parseTraceJson(text: string): ParsedSpans {
  const file = "trace.json";

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    fail(file, `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`);
  }

  const root = asObject(raw, file, "顶层");
  const spans = asArray(root["spans"], file, "spans 字段");

  const llmSpans: LlmSpan[] = [];
  const retrievals: RetrievalCall[] = [];
  let ignoredSpans = 0;

  spans.forEach((entry, i) => {
    const where = `spans[${i}]`;
    const s = asObject(entry, file, where);
    const id = asString(s["id"], file, `${where}.id`);
    // kind 大小写不敏感：otel 包导出的是 LLM/TOOL/... 大写常量，
    // 但 RecordingSession.add_span 的 kind 由调用方传入，不保证大小写。
    const kind = asString(s["kind"], file, `${where}.kind`).toUpperCase();
    const durationMs = asNumber(s["duration_ms"], file, `${where}.duration_ms`);
    const attrs = asObject(s["attributes"] ?? {}, file, `${where}.attributes`);

    if (IGNORED_KINDS.has(kind)) {
      ignoredSpans++;
      return;
    }

    if (!MAPPED_KINDS.has(kind)) {
      // 不认识的 kind 必须报错：静默跳过会让「埋点写错了」表现为「这个 Agent
      // 就是没检索」，是错误归因。
      fail(
        file,
        `${where}.kind 为未知的 ${JSON.stringify(s["kind"])}；` +
          `可识别 ${[...MAPPED_KINDS, ...IGNORED_KINDS].join(" / ")}`,
      );
    }

    if (kind === "LLM") {
      // token 用量缺失记 0：无法凭空推断，0 表示「未知」。该值不参与评分门控。
      const prompt = optional(attrs["prompt_tokens"]);
      const completion = optional(attrs["completion_tokens"]);
      llmSpans.push({
        id,
        promptTokens: prompt === undefined ? 0 : asNumber(prompt, file, `${where}.attributes.prompt_tokens`),
        completionTokens:
          completion === undefined ? 0 : asNumber(completion, file, `${where}.attributes.completion_tokens`),
        latencyMs: durationMs,
      });
      return;
    }

    // RETRIEVAL：必须声明 query 与返回的文档 id——它们正是 S_outcome 的
    // doc_count / retrieval_hit_rate 与「引用忠于检索」断言的依据，缺一不可。
    const query = optional(attrs["query"]);
    const docIds = optional(attrs["returned_doc_ids"]);
    if (query === undefined) {
      fail(file, `${where} 是 RETRIEVAL span，但 attributes 缺 query`);
    }
    if (docIds === undefined) {
      fail(file, `${where} 是 RETRIEVAL span，但 attributes 缺 returned_doc_ids`);
    }
    const call: RetrievalCall = {
      id,
      query: asString(query, file, `${where}.attributes.query`),
      returnedDocIds: asStringArray(docIds, file, `${where}.attributes.returned_doc_ids`),
    };
    // 可选：命中文档正文（供 answer.text 数据流断言）。缺省则不加键，
    // 保持与 manifest.py 的键集一致（往返断言依赖）。
    const docs = optional(attrs["returned_docs"]);
    if (docs !== undefined) {
      const arr = asArray(docs, file, `${where}.attributes.returned_docs`);
      call.returnedDocs = arr.map((d, j) => {
        const o = asObject(d, file, `${where}.attributes.returned_docs[${j}]`);
        return {
          id: asString(o["id"], file, `${where}.attributes.returned_docs[${j}].id`),
          text: asString(o["text"], file, `${where}.attributes.returned_docs[${j}].text`),
        };
      });
    }
    retrievals.push(call);
  });

  return { llmSpans, retrievals, ignoredSpans };
}

// ---------------------------------------------------------------------------
// tool_io.log
// ---------------------------------------------------------------------------

/**
 * `tool_io.log` → `ToolCall[]`（JSON Lines）。
 *
 * 原文结构（python/replay/session.py `add_tool_io`）：
 * `{"tool": str, "input": object, "output": any, "ok": bool, "latency_ms": number, "source": str}`
 *
 * **坏行报错，不跳过**（docs/常见错误与坑.md §1：「JSON Lines 读端按行 split，
 * 未命中一律报错，绝不降级」）。跳过的后果是工具调用凭空少一条，而 S_process
 * 的步数、冗余率、成功率全部建立在这个数组上——少一条就是多算一分。
 *
 * ## `source` 过滤：为什么外部依赖调用不进 `tools`
 *
 * `source="dep"` 是 MockRegistry 记录的外部依赖调用（`http.fetch` /
 * `db.execute` / `file.write_text`），**不计入 `AgentTrace.tools`**：
 *
 * - 计量单位不对：一次 `retrieve()` 内部可能打 3 个外部调用，而用户眼里
 *   那是一步。混在一起算，步数会按外部调用数膨胀。
 * - 白名单对不上：契约里 `tool_call_in` 写的是 Agent 级工具名，永远匹配不到
 *   `db.execute`，于是每条这类断言都恒假——错误归因。
 *
 * 这些记录仍留在文件里，供诊断与防作弊使用，只是不参与评分。
 */
export function parseToolIoLog(text: string): ToolCall[] {
  const file = "tool_io.log";
  const lines = text.split("\n");
  const out: ToolCall[] = [];

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    if (line.trim().length === 0) return; // 允许尾部空行

    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (e) {
      fail(file, `第 ${lineNo} 行不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
    }

    const where = `第 ${lineNo} 行`;
    const rec = asObject(raw, file, where);

    // 缺省按 Agent 工具处理：旧版产物没有 source 字段。
    const source = rec["source"] === undefined ? "agent" : asString(rec["source"], file, `${where}.source`);
    if (source !== "agent" && source !== "dep") {
      fail(file, `${where}.source 为未知值 ${JSON.stringify(source)}；可识别 agent / dep`);
    }
    if (source === "dep") return;

    out.push({
      // id 由**过滤后**的序号决定：坏行会报错中断，因此行序是稳定的。
      id: `tool-${out.length + 1}`,
      name: asString(rec["tool"], file, `${where}.tool`),
      args: asObject(rec["input"] ?? {}, file, `${where}.input`),
      result: rec["output"] ?? null,
      ok: asBoolean(rec["ok"], file, `${where}.ok`),
      latencyMs: asNumber(rec["latency_ms"], file, `${where}.latency_ms`),
    });
  });

  return out;
}

// ---------------------------------------------------------------------------
// result（Agent 的 stdout trace 行）
// ---------------------------------------------------------------------------

/**
 * Agent 输出行 → `FinalAnswer`。
 *
 * 约定（与 `fixtures/tool-agent/main.py` 同源）：Agent 往 stdout 写**一行** JSON：
 * `{"type": "trace", ..., "final_answer": {"text": "...", "cited_doc_ids": [...]}}`
 *
 * 没有 `final_answer` 时返回 `undefined`——不是编一个空答案。空答案会让
 * `answer_has_citation` 恒为 false、`cited_doc_ids ⊆ retrieval_doc_ids` 恒为真
 * （空集是任何集合的子集），两种结果都会误导评分，所以「有没有」必须如实反映。
 */
export function parseResultLine(text: string): FinalAnswer | undefined {
  const file = "result.json";
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (e) {
    fail(file, `不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
  }

  const root = asObject(raw, file, "顶层");
  const fa = optional(root["final_answer"]);
  if (fa === undefined) return undefined;

  const obj = asObject(fa, file, "final_answer");
  return {
    text: asString(obj["text"], file, "final_answer.text"),
    citedDocIds: asStringArray(obj["cited_doc_ids"] ?? [], file, "final_answer.cited_doc_ids"),
  };
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 录制产物 → `AgentTrace`。
 *
 * **纯函数**：相同输入必得相同输出（数组顺序确定、无时间戳、不读文件系统）。
 * 这是「录一次、评两次、结果完全一致」的前提。
 *
 * @throws {RecordingFormatError} 任一产物格式非法。绝不返回一个「尽力而为」的
 *   残缺轨迹——残缺轨迹会让评分看起来正常但数字是错的。
 */
export function parseRecording(files: RecordingFiles): AgentTrace {
  const { llmSpans, retrievals } = parseTraceJson(files.trace);

  const trace: AgentTrace = {
    http: parseHttpYaml(files.http),
    tools: parseToolIoLog(files.toolIo),
    llmSpans,
    retrievals,
  };

  const finalAnswer = files.result === undefined ? undefined : parseResultLine(files.result);
  if (finalAnswer !== undefined) trace.finalAnswer = finalAnswer;

  return trace;
}
