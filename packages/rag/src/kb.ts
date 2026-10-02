/**
 * 知识库：方向模板 + 阶梯提示语料的容器（P3 任务 1）。
 * 纯内存实现，检索器见 retriever.ts。
 */
import type { EntryKind, KnowledgeEntry } from "./types.js";

/** 内置种子语料：可被自定义语料覆盖/追加。 */
export const SEED_CORPUS: readonly KnowledgeEntry[] = [
  // ---- 方向模板（direction）----
  {
    id: "dir-echo",
    text: "回声机器人：读取输入并原样回显，用于熟悉 Agent 运行环境与评分流程。",
    source: "内置方向库#dir-echo",
    tags: ["入门", "echo", "回显", "回声"],
    kind: "direction",
    levelMin: 0,
    levelMax: 2,
  },
  {
    id: "dir-rag-qa",
    text: "RAG 问答 Agent：基于语料库检索并引用出处作答，核心是检索命中率与不幻觉。",
    source: "内置方向库#dir-rag-qa",
    tags: ["rag", "检索", "问答", "向量"],
    kind: "direction",
    levelMin: 2,
    levelMax: 6,
  },
  {
    id: "dir-tool-agent",
    text: "工具调用 Agent：调用外部工具（检索/数据库/文件）完成多步任务，核心是工具选择与参数正确。",
    source: "内置方向库#dir-tool-agent",
    tags: ["工具", "tool", "函数调用", "多步"],
    kind: "direction",
    levelMin: 3,
    levelMax: 6,
  },
  {
    id: "dir-multi-agent",
    text: "多 Agent 协作：拆分角色并编排协作（计划/执行/评审），核心是分工与消息契约。",
    source: "内置方向库#dir-multi-agent",
    tags: ["多agent", "编排", "协作", "计划"],
    kind: "direction",
    levelMin: 5,
    levelMax: 6,
  },
  // ---- 阶梯提示语料（hint）----
  {
    id: "hint-l2-retrieval",
    text: "回想一下：你的回答有没有先从检索结果里找依据？先列出检索命中的文档，再组织语言。",
    source: "内置阶梯库#hint-l2-retrieval",
    tags: ["检索", "引用", "rag"],
    kind: "hint",
    levelMin: 0,
    levelMax: 10,
  },
  {
    id: "hint-l3-architecture",
    text: "从「数据流」想：输入经过哪些步骤变成输出？把每步的输入/输出类型写出来，方案自然浮现。",
    source: "内置阶梯库#hint-l3-architecture",
    tags: ["架构", "数据流", "设计"],
    kind: "hint",
    levelMin: 0,
    levelMax: 10,
  },
  {
    id: "hint-l3-tool-param",
    text: "工具调用报错时，先核对参数类型与取值是否落在契约白名单内，再看返回结构。",
    source: "内置阶梯库#hint-l3-tool-param",
    tags: ["工具", "参数", "白名单"],
    kind: "hint",
    levelMin: 0,
    levelMax: 10,
  },
];

export class KnowledgeBase {
  private readonly entries: KnowledgeEntry[];

  constructor(entries: readonly KnowledgeEntry[] = []) {
    this.entries = [...entries];
  }

  static fromSeed(): KnowledgeBase {
    return new KnowledgeBase(SEED_CORPUS);
  }

  /** 追加语料（去重：同 id 后者覆盖前者）。 */
  add(entries: readonly KnowledgeEntry[]): this {
    for (const e of entries) {
      const i = this.entries.findIndex((x) => x.id === e.id);
      if (i >= 0) this.entries[i] = e;
      else this.entries.push(e);
    }
    return this;
  }

  /** 按类型/档位过滤全部条目。 */
  list(filter?: { kind?: EntryKind; level?: number }): KnowledgeEntry[] {
    return this.entries.filter((e) => {
      if (filter?.kind && e.kind !== filter.kind) return false;
      if (filter?.level !== undefined) {
        if (e.levelMin !== undefined && filter.level < e.levelMin) return false;
        if (e.levelMax !== undefined && filter.level > e.levelMax) return false;
      }
      return true;
    });
  }

  get size(): number {
    return this.entries.length;
  }
}
