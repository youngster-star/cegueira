/**
 * 防线 2：改写提问。
 *
 * 对同一题目做同义改写，使「if prompt == "..." return "硬编码答案"」失效。
 * P2 阶段用确定性模板（同义词替换 + 语序微调），P4 校准后接入 LLM 改写。
 * 可代码判定的硬编码信号：答案与题目字面重叠度过高（Agent 把题目抄进答案）。
 */

const SYNONYMS: Record<string, string[]> = {
  什么是: ["请解释", "请说明"],
  解释: ["说明", "阐述"],
  如何: ["怎样", "怎么"],
  为什么: ["为何", "出于什么原因"],
  区别: ["差异", "不同之处"],
};

/**
 * 生成确定性改写（variant 用于在同义词列表中轮转）。
 * 只替换首个命中的同义词并立即返回，避免「链式替换」（如「什么是→请解释」后
 * 「解释」又被二次替换导致不同 variant 结果相同）。
 */
export function rewritePrompt(prompt: string, variant: number): string {
  for (const [key, repls] of Object.entries(SYNONYMS)) {
    if (prompt.includes(key)) {
      return prompt.replace(key, repls[variant % repls.length]);
    }
  }
  // 无同义词命中，附加改写标记：改变字面、保留作答要求。
  return `${prompt.trim()}（请用自己的话作答）`;
}

/** 字符 n-gram 集合（忽略空白）。 */
function ngrams(s: string, n: number): Set<string> {
  const set = new Set<string>();
  const clean = s.replace(/\s+/g, "");
  if (clean.length < n) return set;
  for (let i = 0; i + n <= clean.length; i++) {
    set.add(clean.slice(i, i + n));
  }
  return set;
}

/** 题目与答案的字面重叠度（0–1）。 */
export function overlapRatio(prompt: string, answer: string): number {
  const pg = ngrams(prompt, 4);
  if (pg.size === 0) return 0;
  const ag = ngrams(answer, 4);
  let hit = 0;
  for (const g of pg) if (ag.has(g)) hit++;
  return hit / pg.size;
}

const HARDCODED_THRESHOLD = 0.7;

/** 答案是否疑似复制题目（硬编码嫌疑）。 */
export function detectHardcoded(prompt: string, answer: string): boolean {
  return overlapRatio(prompt, answer) > HARDCODED_THRESHOLD;
}
