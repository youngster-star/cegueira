/**
 * 极简命令行参数解析（零依赖，避免引入 commander）。
 * 支持 `--key value` 与 `--flag`。
 */
export interface ParsedArgs {
  command: string;
  options: Record<string, string>;
  flags: Set<string>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] ?? "help";
  const options: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        options[key] = next;
        i++;
      } else {
        flags.add(key);
      }
    }
  }
  return { command, options, flags };
}
