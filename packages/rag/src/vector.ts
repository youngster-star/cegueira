/**
 * 向量检索器（P3 剩余项）：用 embedding 余弦相似度替代关键词匹配，
 * 实现与 `KeywordRetriever` 相同的检索语义（含 level/kind 过滤、未命中回退）。
 *
 * 设计说明：
 * - **embedder 可注入**：真实实现（如 Ollama）在 `@cegueira/llm`，本包不反向依赖，
 *   只依赖一个结构化的 `Embedder` 接口——测试用确定性假 embedder，无需联网。
 * - **条目向量惰性计算并缓存**：首次 `retrieve` 时对全部条目编码一次，之后复用。
 * - **查询向量每次现算**：查询随会话变化，不能缓存。
 */
import type { KnowledgeBase } from "./kb.js";
import type { EntryKind, KnowledgeEntry, RetrievalResult, RetrievedEntry } from "./types.js";

/** 文本嵌入器：把一批文本映射为等长向量（异步，因真实实现走网络）。 */
export interface Embedder {
  id: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface VectorRetrieveOptions {
  /** 技能档（0–10 分制），用于过滤难度档。 */
  level?: number;
  /** 只检索指定类型。 */
  kind?: EntryKind;
  /** 余弦相似度下限（默认 0.2）。 */
  minScore?: number;
  /** 返回条数上限（默认 5）。 */
  topK?: number;
}

/** 余弦相似度。零向量与任一向量相似度记 0（而非 NaN）。 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new RangeError(`向量维度不一致：${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export class VectorRetriever {
  private index: { entry: KnowledgeEntry; vector: number[] }[] | null = null;

  constructor(
    private readonly kb: KnowledgeBase,
    private readonly embedder: Embedder,
  ) {}

  /** 惰性构建条目向量索引（只做一次）。 */
  private async ensureIndex(): Promise<{ entry: KnowledgeEntry; vector: number[] }[]> {
    if (this.index !== null) return this.index;
    const entries = this.kb.list();
    const vectors = await this.embedder.embed(entries.map((e) => e.text));
    if (vectors.length !== entries.length) {
      throw new RangeError(
        `embedder 返回向量数(${vectors.length})与条目数(${entries.length})不符`,
      );
    }
    this.index = entries.map((entry, i) => ({ entry, vector: vectors[i] }));
    return this.index;
  }

  async retrieve(query: string, options: VectorRetrieveOptions = {}): Promise<RetrievalResult> {
    const q = query.trim();
    if (!q) return { hits: [], answered: false };

    const minScore = options.minScore ?? 0.2;
    const topK = options.topK ?? 5;

    const index = await this.ensureIndex();
    const queryVectors = await this.embedder.embed([q]);
    const qv = queryVectors[0];
    if (qv === undefined) throw new RangeError("embedder 未返回查询向量");

    // 过滤集与 KeywordRetriever 一致，保证两种检索器的召回口径可对齐。
    const allowed = new Set(
      this.kb.list({ kind: options.kind, level: options.level }).map((e) => e.id),
    );

    const hits: RetrievedEntry[] = [];
    for (const { entry, vector } of index) {
      if (!allowed.has(entry.id)) continue;
      const score = cosineSimilarity(qv, vector);
      if (score >= minScore) hits.push({ entry, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return { hits: hits.slice(0, topK), answered: hits.length > 0 };
  }
}
