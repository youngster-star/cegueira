/**
 * AST 裁剪（轻量实现）：只保留「结构 + 签名」，去掉实现体与字面量，
 * 进一步减小外发内容（PRD §7「AST 裁剪」）。
 *
 * 用启发式行级处理替代完整 AST 解析：
 * 1. 去注释（Python `#`、C 系 `//` 与块注释）
 * 2. 去字面量（字符串 → "…"、数字 → N）
 * 3. 折叠函数体（保留签名行，缩进体替换为占位）
 */

/** 去注释。 */
export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/#[^\n]*/g, "");
}

/** 去字符串/数字字面量。 */
export function stripLiterals(text: string): string {
  return text
    .replace(/"([^"\\]|\\.)*"/g, '"…"')
    .replace(/'([^'\\]|\\.)*'/g, "'…'")
    .replace(/\b\d+(\.\d+)?\b/g, "N");
}

/** 折叠函数体：保留块起始签名行，缩进体替换为占位。 */
export function pruneBodies(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    out.push(line);
    const opensBlock =
      /^(?:async\s+def|def|class|if|elif|else|for|while|with|try|except|finally|match|case)\b.*:\s*$/.test(
        trimmed,
      ) ||
      (/[{(]\s*$/.test(trimmed) && !trimmed.endsWith(";"));
    if (opensBlock) {
      let j = i + 1;
      while (j < lines.length && (lines[j].trim() === "" || /^\s/.test(lines[j]))) {
        j++;
      }
      if (j > i + 1) out.push("    …  // body pruned");
      i = j;
    } else {
      i++;
    }
  }
  return out.join("\n");
}

/** 完整裁剪：去注释 → 去字面量 → 折叠函数体。 */
export function pruneAst(text: string): string {
  return pruneBodies(stripLiterals(stripComments(text)));
}
