import type { RedactionResult } from "./types.js";

interface Pattern {
  category: string;
  re: RegExp;
  repl: string;
}

/** 本地脱敏规则：邮箱/手机/密钥/内网 IP。 */
const PATTERNS: Pattern[] = [
  {
    category: "email",
    re: /[\w.+-]+@[\w-]+\.[\w.-]+/g,
    repl: "[EMAIL]",
  },
  {
    category: "phone",
    re: /(?:\+?86[- ]?)?1[3-9]\d{9}/g,
    repl: "[PHONE]",
  },
  {
    category: "api_key",
    re: /\b(?:sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})\b/g,
    repl: "[KEY]",
  },
  {
    category: "secret",
    re: /\b(api[_-]?key|secret|token|password|passwd)\s*[=:]\s*["']?[A-Za-z0-9._~/-]{8,}["']?/gi,
    repl: "$1=[REDACTED]",
  },
  {
    category: "bearer",
    re: /(bearer\s+)[A-Za-z0-9._-]+/gi,
    repl: "$1[TOKEN]",
  },
  {
    category: "internal_ip",
    re: /\b(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)\d{1,3}\.\d{1,3}\b/g,
    repl: "[IP]",
  },
];

/**
 * 本地脱敏：正则替换敏感信息。返回脱敏文本与命中类别。
 */
export function redact(text: string): RedactionResult {
  let out = text;
  const hits = new Set<string>();
  for (const { category, re, repl } of PATTERNS) {
    const before = out;
    out = out.replace(re, repl);
    if (out !== before) hits.add(category);
  }
  return { text: out, hitCount: hits.size, hits: [...hits] };
}
