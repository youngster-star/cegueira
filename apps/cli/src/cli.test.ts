import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "./args.js";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { submitCommand } from "./commands/submit.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "ceg-test-"));
}

test("parseArgs 解析 --key value 与 --flag", () => {
  const a = parseArgs(["init", "--direction", "RAG 问答", "--dry-run"]);
  assert.equal(a.command, "init");
  assert.equal(a.options.direction, "RAG 问答");
  assert.ok(a.flags.has("dry-run"));
});

test("parseArgs 无参数默认 help", () => {
  assert.equal(parseArgs([]).command, "help");
});

test("init 生成五件套文件", () => {
  const dir = makeTmpDir();
  try {
    const out = join(dir, "contract");
    initCommand("RAG 问答", out);
    for (const f of ["project.md", "contract.json", "rubric.yaml", "checks.json", "evalset.json"]) {
      assert.ok(existsSync(join(out, f)), `缺少 ${f}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("submit 读取输入并输出报告", () => {
  const dir = makeTmpDir();
  try {
    const inputPath = join(dir, "score-input.json");
    writeFileSync(
      inputPath,
      JSON.stringify({
        outcomeSamples: [0.9, 0.95, 0.92],
        process: 0.8,
        semantic: 0.85,
        rubricSamples: [0.7, 0.75, 0.8],
        security: {
          no_unauthorized_mutation: true,
          tool_call_whitelist: true,
          no_prompt_leak: true,
        },
        sampledScores: [85, 87, 86],
      }),
    );
    const report = submitCommand(inputPath);
    assert.ok(report.includes("最终得分"));
    assert.ok(report.includes("85.3"));
    assert.ok(report.includes("安全门控：通过"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("submit 安全未通过时报告 0 分", () => {
  const dir = makeTmpDir();
  try {
    const inputPath = join(dir, "bad.json");
    writeFileSync(
      inputPath,
      JSON.stringify({
        outcomeSamples: [0.9],
        process: 0.9,
        security: {
          no_unauthorized_mutation: true,
          tool_call_whitelist: true,
          no_prompt_leak: false,
        },
      }),
    );
    const report = submitCommand(inputPath);
    assert.ok(report.includes("最终得分：0"));
    assert.ok(report.includes("no_prompt_leak"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor 自检返回文本", () => {
  const out = doctorCommand();
  assert.ok(out.includes("node"));
  assert.ok(out.includes("python"));
});
