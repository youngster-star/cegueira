/**
 * ceg CLI 命令分发。
 */
import { parseArgs } from "./args.js";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { submitCommand } from "./commands/submit.js";

export const HELP_TEXT = `Cegueira 陪练 CLI

用法：ceg <command> [options]

命令：
  init     生成契约五件套（--direction <方向>，默认「RAG 问答 Agent」）
  submit   提交评分（--input <评分输入json>）
  doctor   环境自检

示例：
  ceg init --direction "RAG 问答"
  ceg submit --input score-input.json
  ceg doctor
`;

/** 命令分发。 */
export function run(argv: string[]): void {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case "init": {
      const direction = options.direction ?? options.d ?? "RAG 问答 Agent";
      const outDir = initCommand(direction);
      console.log(`✓ 已生成契约五件套到 ${outDir}/`);
      break;
    }
    case "submit": {
      const input = options.input ?? options.i;
      if (!input) {
        throw new Error("submit 需要 --input <评分输入json>");
      }
      console.log(submitCommand(input));
      break;
    }
    case "doctor": {
      console.log(doctorCommand());
      break;
    }
    case "help":
    case "--help":
    case "-h": {
      console.log(HELP_TEXT);
      break;
    }
    default: {
      console.error(`未知命令: ${command}\n\n${HELP_TEXT}`);
      process.exitCode = 1;
    }
  }
}
