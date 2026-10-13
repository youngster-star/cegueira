/**
 * ceg CLI 命令分发。
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "./args.js";
import { doctorCommand } from "./commands/doctor.js";
import { gradeCommand } from "./commands/grade.js";
import { historyCommand } from "./commands/history.js";
import { initCommand } from "./commands/init.js";
import { calibrateCommand } from "./commands/calibrate.js";
import { profileCommand } from "./commands/profile.js";
import { recordCommand } from "./commands/record.js";
import { rubricCommand } from "./commands/rubric.js";
import { scanCommand } from "./commands/scan.js";
import { submitCommand } from "./commands/submit.js";
import { verifyBundle, verifyCommand } from "./commands/verify.js";

export const HELP_TEXT = `Cegueira 陪练 CLI

用法：ceg <command> [options]

命令：
  init     生成契约五件套（--direction <方向>，默认「RAG 问答 Agent」）
  record   跑 Agent 并落录制产物（--agent <目录> --out <录制目录> [--evalset <evalset.json>] [--mock-mode record|replay] [--deps-dir <目录>]）
  grade    契约 + 录制目录 → 评分报告（--contract <contract.json> --run <录制目录> [--store <目录>] [--system-prompt <文件>] [--evalset <evalset.json>] [--ran-cases a,b] [--case <id>] [--rubric-scores <scores.json>] [--rubric-file <rubric.yaml>] [--source <源码目录>]）
  scan     L1 静态分析（--path <文件或目录>）
  rubric   LLM 评审 rubric 维度（--rubric <yaml|json> --artifact <文件> [--llm a,b] [--budget <tokens>] [--out <scores.json>] [--yes]）
  calibrate 校准报告（--labels <人工标注json>）
  profile  技能画像聚合（--store <数据目录> [--skill <名>]）
  history  评分历史（--store <数据目录> [--project <id>]）
  submit   提交评分（--input <评分输入json>）
  verify   契约五件套自检（--dir <契约目录>，默认 cegueira-contract）
  doctor   环境自检

示例：
  ceg init --direction "RAG 问答"
  ceg record --agent ./my-agent --out recordings/run-1
  ceg grade --contract cegueira-contract/contract.json --run recordings/run-1 --store .ceg-data
  ceg scan --path ./my-agent
  ceg rubric --rubric cegueira-contract/rubric.yaml --artifact ./my-agent/main.py --yes
  ceg calibrate --labels calibration-labels.json
  ceg profile --store .ceg-data
  ceg history --store .ceg-data
  ceg submit --input score-input.json
  ceg verify --dir cegueira-contract
  ceg doctor
`;

/** 命令分发。 */
export async function run(argv: string[]): Promise<void> {
  const { command, options, flags } = parseArgs(argv);
  switch (command) {
    case "init": {
      const direction = options.direction ?? options.d ?? "RAG 问答 Agent";
      // 透传 --out/--o：此前被忽略，--out 形同虚设（永远落到默认目录）。
      const outDir = initCommand(direction, options.out ?? options.o);
      console.log(`✓ 已生成契约五件套到 ${outDir}/`);
      break;
    }
    case "record": {
      const agent = options.agent ?? options.a;
      const out = options.out ?? options.o;
      if (!agent) throw new Error("record 需要 --agent <Agent 目录>");
      if (!out) throw new Error("record 需要 --out <录制输出目录>");
      const timeout = options.timeout;
      console.log(
        recordCommand({
          agentDir: agent,
          runDir: out,
          entry: options.entry,
          upstream: options.upstream,
          python: options.python,
          repoRoot: options.root,
          timeoutSec: timeout !== undefined ? Number(timeout) : undefined,
          evalset: options.evalset,
          mockMode: options["mock-mode"] === "replay" ? "replay" : options["mock-mode"] === "record" ? "record" : undefined,
          depsDir: options["deps-dir"],
        }),
      );
      break;
    }
    case "grade": {
      const contract = options.contract ?? options.c;
      const run = options.run ?? options.r;
      if (!contract) throw new Error("grade 需要 --contract <contract.json>");
      if (!run) throw new Error("grade 需要 --run <录制目录>");
      const systemPromptPath = options["system-prompt"];
      const systemPrompt = systemPromptPath ? readFileSync(systemPromptPath, "utf8") : undefined;
      const ranCases = options["ran-cases"]
        ? options["ran-cases"].split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
      console.log(
        gradeCommand({
          contractPath: contract,
          runDir: run,
          securityJson: options.security,
          storeDir: options.store,
          systemPrompt,
          evalsetPath: options.evalset,
          ranCases,
          caseId: options.case,
          rubricScoresPath: options["rubric-scores"],
          rubricPath: options["rubric-file"],
          sourcePath: options.source,
        }),
      );
      break;
    }
    case "history": {
      const store = options.store ?? options.s;
      if (!store) throw new Error("history 需要 --store <数据目录>");
      console.log(historyCommand(store, options.project));
      break;
    }
    case "scan": {
      const path = options.path ?? options.p;
      if (!path) throw new Error("scan 需要 --path <文件或目录>");
      console.log(scanCommand(path));
      break;
    }
    case "rubric": {
      const rubric = options.rubric;
      const artifact = options.artifact;
      if (!rubric) throw new Error("rubric 需要 --rubric <rubric.json>");
      if (!artifact) throw new Error("rubric 需要 --artifact <被评审文件>");
      const llms = options.llm ? options.llm.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      const purpose = options.purpose === "generation" ? "generation" : "review";
      let budgetTokens: number | undefined;
      if (options.budget !== undefined) {
        budgetTokens = Number(options.budget);
        if (!Number.isFinite(budgetTokens) || budgetTokens <= 0) {
          throw new Error("--budget 须为正数（token 上限）");
        }
      }
      console.log(
        await rubricCommand({
          rubricPath: rubric,
          artifactPath: artifact,
          llms,
          model: options.model,
          baseUrl: options["base-url"],
          apiKey: options["api-key"],
          purpose,
          confirmed: flags.has("yes"),
          budgetTokens,
          outPath: options.out,
        }),
      );
      break;
    }
    case "calibrate": {
      const labels = options.labels;
      if (!labels) throw new Error("calibrate 需要 --labels <人工标注json>");
      console.log(calibrateCommand({ labelsPath: labels }));
      break;
    }
    case "profile": {
      const storeDir = options.store;
      if (!storeDir) throw new Error("profile 需要 --store <数据目录>");
      console.log(profileCommand({ storeDir, skill: options.skill }));
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
    case "verify": {
      const dir = options.dir ?? options.d ?? "cegueira-contract";
      console.log(verifyCommand(dir));
      if (!verifyBundle(dir).ok) process.exitCode = 1;
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
