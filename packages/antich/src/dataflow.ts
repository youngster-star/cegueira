/**
 * 防线 3：数据流断言。
 *
 * 检查答案的引用是否真的来自检索结果或工具返回，而非凭空捏造（伪造引用）。
 */
import type { AgentTrace } from "@cegueira/trace";
import type { DataFlowAssertion } from "./types.js";

/** 尽力从工具返回值中提取 id（对象/数组的 "id" 字段）。 */
export function extractIds(result: unknown): string[] {
  const ids: string[] = [];
  if (Array.isArray(result)) {
    for (const item of result) ids.push(...extractIds(item));
  } else if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (typeof obj.id === "string") ids.push(obj.id);
    for (const v of Object.values(obj)) ids.push(...extractIds(v));
  }
  return ids;
}

/** 递归收集工具返回值中的所有字符串（供 answer.text 的字面支撑判定）。 */
export function extractStrings(result: unknown): string[] {
  const out: string[] = [];
  if (typeof result === "string") {
    out.push(result);
  } else if (Array.isArray(result)) {
    for (const item of result) out.push(...extractStrings(item));
  } else if (result && typeof result === "object") {
    for (const v of Object.values(result as Record<string, unknown>)) {
      out.push(...extractStrings(v));
    }
  }
  return out;
}

/** 字符 n-gram 集合（去空白）。 */
function charNgrams(s: string, n = 4): Set<string> {
  const clean = s.replace(/\s+/g, "");
  const set = new Set<string>();
  for (let i = 0; i + n <= clean.length; i++) set.add(clean.slice(i, i + n));
  return set;
}

/**
 * 答案文本相对「来源正文」的最大字面支撑度（0–1）：
 * 答案的 4-gram 中，有多大比例出现在**某一份**来源正文里。
 *
 * - 返回 `null` 表示无法判定（答案或来源正文太短/为空）——调用方应跳过，不误报。
 * - 返回 `0` 表示答案与任何来源正文**没有任何 4-gram 重叠**，是「凭空捏造」的强信号。
 *
 * 这是确定性 MVP（无网络/无 embedding），与 `@cegueira/rag` 的
 * KeywordRetriever→VectorRetriever 同一思路：日后可用 embedding 相似度替换本函数，
 * 而 checkDataFlow 的结构不变。
 */
export function textGroundedness(answer: string, sources: string[]): number | null {
  const texts = sources.filter((t) => t.length > 0);
  if (texts.length === 0) return null;
  const ag = charNgrams(answer);
  if (ag.size === 0) return null;
  let best = 0;
  for (const t of texts) {
    const tg = charNgrams(t);
    let hit = 0;
    for (const g of ag) if (tg.has(g)) hit++;
    best = Math.max(best, hit / ag.size);
  }
  return best;
}

/** 数据流断言支持的字段。 */
const SUPPORTED_FIELDS = new Set(["answer.cited_doc_ids", "answer.text"]);

/**
 * 校验数据流断言，返回违规项列表（空数组表示全部通过）。
 * 支持的 field：
 * - "answer.cited_doc_ids"：答案引用的文档 id 必须来自检索/工具返回。
 * - "answer.text"：答案正文必须有来源（检索文档 / 工具返回）的字面支撑，
 *   否则判「疑似幻觉」。**来源正文缺失时跳过**（不误报）。
 */
export function checkDataFlow(
  trace: AgentTrace,
  assertions: DataFlowAssertion[],
): string[] {
  const violations: string[] = [];
  const final = trace.finalAnswer;

  for (const a of assertions) {
    if (!SUPPORTED_FIELDS.has(a.field)) {
      // 未实现的 field 不报错也不判定（留待扩展）。
      continue;
    }
    if (!final) {
      violations.push(`断言 ${a.field}: 缺少最终答案`);
      continue;
    }

    if (a.field === "answer.cited_doc_ids") {
      if (a.source === "retrieval") {
        const retrieved = new Set(trace.retrievals.flatMap((r) => r.returnedDocIds));
        for (const id of final.citedDocIds) {
          if (!retrieved.has(id)) {
            violations.push(`引用不存在的文档 "${id}"（未在检索结果中出现）`);
          }
        }
      } else if (a.source === "tool") {
        const toolIds = new Set(trace.tools.flatMap((t) => extractIds(t.result)));
        for (const id of final.citedDocIds) {
          if (!toolIds.has(id)) {
            violations.push(`引用未由工具返回的 id "${id}"`);
          }
        }
      }
      continue;
    }

    // answer.text
    const sources =
      a.source === "retrieval"
        ? trace.retrievals.flatMap((r) => (r.returnedDocs ?? []).map((d) => d.text))
        : trace.tools.flatMap((t) => extractStrings(t.result));
    const grounded = textGroundedness(final.text, sources);
    if (grounded === null) continue; // 无来源正文/答案过短 → 无法判定，跳过
    if (grounded === 0) {
      violations.push(
        `答案文本与${a.source === "retrieval" ? "检索内容" : "工具返回"}无任何字面重叠，疑似幻觉`,
      );
    }
  }
  return violations;
}
