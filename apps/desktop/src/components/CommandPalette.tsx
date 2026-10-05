import { useEffect, useMemo, useRef, useState } from "react";
import { filterCommands, type Command } from "../lib/commands";

interface Props {
  commands: Command[];
  onRun: (cmd: Command) => void;
  onClose: () => void;
  placeholder?: string;
  emptyText?: string;
}

/** 命令面板（Ctrl/Cmd+K 打开）：搜索 + 键盘上下导航 + 回车执行 + Esc 关闭。 */
export default function CommandPalette({
  commands,
  onRun,
  onClose,
  placeholder,
  emptyText,
}: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => filterCommands(commands, query), [commands, query]);

  // 查询变化时重置选中项
  useEffect(() => setActive(0), [query]);

  // 自动聚焦输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      const cmd = matches[active];
      if (cmd && !cmd.disabled) {
        onRun(cmd);
        onClose();
      }
    }
  };

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="Search commands"
        />
        <div className="palette-list" role="listbox" aria-label="Commands">
          {matches.length === 0 && <div className="palette-empty">{emptyText}</div>}
          {matches.map((cmd, i) => (
            <button
              key={cmd.id}
              className={`palette-item ${i === active ? "active" : ""}`}
              role="option"
              aria-selected={i === active}
              disabled={cmd.disabled}
              onClick={() => {
                if (!cmd.disabled) {
                  onRun(cmd);
                  onClose();
                }
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="palette-label">{cmd.label}</span>
              {cmd.hint && <span className="palette-hint">{cmd.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
