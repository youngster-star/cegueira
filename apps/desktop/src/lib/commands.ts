/**
 * 命令面板数据模型与过滤逻辑（纯函数，零依赖）。
 */

export interface Command {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/**
 * 按查询词过滤命令：在 id / label / hint 上做大小写不敏感的子串匹配。
 * 空查询返回全部命令。
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => {
    const haystack = `${c.id} ${c.label} ${c.hint ?? ""}`.toLowerCase();
    return haystack.includes(q);
  });
}
