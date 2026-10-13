/**
 * ceg CLI 命令分发。
 */
import { parseArgs } from "./args.js";
import { doctorCommand } from "./commands/doctor.js";
import { gradeCommand } from "./commands/grade.js";
import { initCommand } from "./commands/init.js";
import { submitCommand } from "./commands/submit.js";

export const HELP_TEXT = `Cegueira 陪练 CLI

用法：ceg <command> [options]

命令：
  init     生成契约五件套（--direction <方向>，默认「RAG 问答 Agent」）
  grade    契约 + 录制目录 → 评分报告（--contract <contract.json> --run <录制目录>）
  submit   提交评分（--input <评分输入json>）
  doctor   环境自检

示例：
  ceg init --direction "RAG 问答"
  ceg grade --contract cegueira-contract/contract.json --run recordings/run-1
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
    case "grade": {
      const contract = options.contract ?? options.c;
      const run = options.run ?? options.r;
      if (!contract) throw new Error("grade 需要 --contract <contract.json>");
      if (!run) throw new Error("grade 需要 --run <录制目录>");
      console.log(gradeCommand(contract, run, options.security));
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
