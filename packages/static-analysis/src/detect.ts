import type { Finding, ScanReport, SeverityCounts, WeaknessSeverity } from "./types.js";

interface Rule {
  category: string;
  severity: WeaknessSeverity;
  re: RegExp;
  message: string;
}

/**
 * L1 静态分析规则（PRD §4.1 / §4.8）：
 * 硬编码密钥、危险 eval/exec、反序列化、SQL 拼接、明文密码等。
 * 只做确定性代码扫描，不引入 LLM。
 */
const RULES: Rule[] = [
  {
    category: "hardcoded_api_key",
    severity: "high",
    re: /\b(?:sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)\b/,
    message: "检测到硬编码密钥",
  },
  {
    category: "dangerous_eval",
    severity: "high",
    re: /\beval\s*\(/,
    message: "使用 eval() 执行动态代码",
  },
  {
    category: "dangerous_exec",
    severity: "high",
    re: /\b(?:exec\s*\(|execfile\s*\(|os\.system\s*\(|subprocess\.(?:call|run|Popen)\s*\()/,
    message: "调用危险系统命令",
  },
  {
    category: "unsafe_pickle",
    severity: "high",
    re: /\bpickle\.loads?\s*\(/,
    message: "反序列化不可信数据（pickle）",
  },
  {
    category: "unsafe_yaml",
    severity: "medium",
    re: /\byaml\.load\s*\(/,
    message: "yaml.load 可执行任意代码，建议 safe_load",
  },
  {
    category: "destructive_rm",
    severity: "medium",
    re: /\brm\s+-rf\b/,
    message: "递归强制删除",
  },
  {
    category: "sql_injection",
    severity: "medium",
    re: /(?:SELECT|INSERT|UPDATE|DELETE)\b[^"]*["']\s*\+/i,
    message: "疑似字符串拼接 SQL",
  },
  {
    category: "password_plaintext",
    severity: "low",
    re: /\b(?:password|passwd)\s*[=:]\s*["'][^"']{4,}["']/i,
    message: "明文密码",
  },
];

const SEVERITY_WEIGHT: Record<WeaknessSeverity, number> = {
  high: 1,
  medium: 0.5,
  low: 0.2,
};

/** 对源码做 L1 静态扫描，返回弱点的行号定位与加权计数。 */
export function scan(code: string): ScanReport {
  const lines = code.split("\n");
  const findings: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        findings.push({
          category: rule.category,
          severity: rule.severity,
          line: i + 1,
          message: rule.message,
        });
      }
    }
  }

  const counts: SeverityCounts = { high: 0, medium: 0, low: 0, total: findings.length };
  let weaknessScore = 0;
  for (const f of findings) {
    counts[f.severity]++;
    weaknessScore += SEVERITY_WEIGHT[f.severity];
  }
  return { findings, counts, weaknessScore };
}
