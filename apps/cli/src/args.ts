/**
 * 极简命令行参数解析（零依赖，避免引入 commander）。
 * 支持 `--key value`、`--key=value` 与 `--flag` 三种形式。
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
      const body = a.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        // --key=value 形式（value 可为空串）
        const key = body.slice(0, eq);
        if (key.length > 0) options[key] = body.slice(eq + 1);
        // key 为空（"--=x"）则忽略该参数
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          options[body] = next;
          i++;
        } else {
          flags.add(body);
        }
      }
    }
  }
  return { command, options, flags };
}
