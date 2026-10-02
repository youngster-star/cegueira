/**
 * 检索器：关键词 + 技能档过滤（确定性、可测试）。
 *
 * 设计说明：P3 阶段用「标签/子串匹配」作 MVP 检索，纯代码可判定，
 * 不引入 embedding/LLM 依赖（遵循「LLM 只说话、不打分」原则）。
 * 真正的向量检索（embedding）可通过实现同一 Retriever 接口在后续替换。
 */
import type { KnowledgeBase } from "./kb.js";
import type {
  EntryKind,
  RetrievalResult,
  RetrievedEntry,
} from "./types.js";

export interface RetrieveOptions {
  /** 技能档（0–10 分制），用于过滤难度档。 */
  level?: number;
  /** 只检索指定类型。 */
  kind?: EntryKind;
  /** 命中得分下限（默认 1，即至少命中一个 tag 或一个词）。 */
  minScore?: number;
}

export interface Retriever {
  retrieve(query: string, options?: RetrieveOptions): RetrievalResult;
}

/** 英文单词 + 中文 bigram 分词。 */
export function tokenize(s: string): string[] {
  const lower = s.toLowerCase();
  const words = lower.match(/[a-z0-9]+/g) ?? [];
  const han = lower.match(/[\u4e00-\u9fa5]+/g) ?? [];
  const bigrams: string[] = [];
  for (const h of han) {
    for (let i = 0; i + 1 < h.length; i++) {
      bigrams.push(h.slice(i, i + 2));
    }
  }
  return [...words, ...bigrams];
}

/** 条目匹配得分：tag 命中权重 2，text 词命中权重 1。 */
export function scoreEntry(query: string, text: string, tags: string[]): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let score = 0;
  for (const tag of tags) {
    const tagNorm = tag.trim().toLowerCase();
    // 空 tag（''）会让 includes 恒 true，必须跳过，否则任何查询都命中该条目
    if (tagNorm && q.includes(tagNorm)) score += 2;
  }
  for (const tok of tokenize(q)) {
    if (tok.length >= 2 && t.includes(tok)) score += 1;
  }
  return score;
}

export class KeywordRetriever implements Retriever {
  constructor(private readonly kb: KnowledgeBase) {}

  retrieve(query: string, options: RetrieveOptions = {}): RetrievalResult {
    const minScore = options.minScore ?? 1;
    const q = query.trim();
    if (!q) return { hits: [], answered: false };

    const hits: RetrievedEntry[] = [];
    for (const entry of this.kb.list({ kind: options.kind, level: options.level })) {
      const score = scoreEntry(q, entry.text, entry.tags);
      if (score >= minScore) hits.push({ entry, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return { hits, answered: hits.length > 0 };
  }
}
