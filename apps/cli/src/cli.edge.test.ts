import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "./args.js";
import { run } from "./cli.js";
import { doctorCommand } from "./commands/doctor.js";
import { submitCommand } from "./commands/submit.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "ceg-edge-"));
}

test("parseArgs：多个 flag 与多个 option 并存", () => {
  const a = parseArgs(["init", "--direction", "RAG", "--dry-run", "--verbose", "--model", "gpt-4"]);
  assert.equal(a.options.direction, "RAG");
  assert.equal(a.options.model, "gpt-4");
  assert.ok(a.flags.has("dry-run"));
  assert.ok(a.flags.has("verbose"));
});

test("parseArgs：末尾 --flag 无 value 时正确归为 flag", () => {
  const a = parseArgs(["submit", "--input", "x.json", "--force"]);
  assert.equal(a.options.input, "x.json");
  assert.ok(a.flags.has("force"));
});

test("parseArgs：裸参数（非 -- 开头）被忽略", () => {
  const a = parseArgs(["init", "positional", "--direction", "RAG"]);
  assert.equal(a.options.direction, "RAG");
});

test("parseArgs：--key=value 形式正确拆解", () => {
  const a = parseArgs(["init", "--direction=RAG"]);
  assert.equal(a.options.direction, "RAG");
  assert.equal(a.command, "init");
});

test("parseArgs：--key= 空值形式正确解析", () => {
  const a = parseArgs(["init", "--direction="]);
  assert.equal(a.options.direction, "");
});

test("parseArgs：--=x 空 key 被忽略", () => {
  const a = parseArgs(["init", "--=x"]);
  assert.equal(a.command, "init");
  assert.equal(Object.keys(a.options).length, 0);
});

test("doctorCommand：venv 不存在时标记 ✗", () => {
  const empty = makeTmpDir();
  try {
    const out = doctorCommand(empty); // 空目录，无 .venv
    assert.ok(out.includes("venv"));
    assert.ok(out.includes("✗"), "venv 缺失应标记 ✗");
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("doctorCommand：venv 存在时标记 ✓", () => {
  const out = doctorCommand(join(process.cwd(), ".")); // 项目根有 .venv
  assert.ok(out.includes("✓"));
});

test("submitCommand：输入缺 security 字段时抛错而非静默通过", () => {
  const dir = makeTmpDir();
  try {
    const inputPath = join(dir, "missing-security.json");
    writeFileSync(
      inputPath,
      JSON.stringify({ outcomeSamples: [0.9], process: 0.8 }),
    );
    // security 缺失 → runGates 读到 undefined 字段，应被判定为未通过（而非崩溃）
    const report = submitCommand(inputPath);
    assert.ok(report.includes("最终得分：0"), "缺 security 应安全门控不通过");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("submitCommand：outcomeSamples 空数组抛错", () => {
  const dir = makeTmpDir();
  try {
    const inputPath = join(dir, "empty-outcome.json");
    writeFileSync(
      inputPath,
      JSON.stringify({
        outcomeSamples: [],
        process: 0.8,
        security: { no_unauthorized_mutation: true, tool_call_whitelist: true, no_prompt_leak: true },
      }),
    );
    assert.throws(() => submitCommand(inputPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run：未知命令设置非零退出码且打印帮助", () => {
  const err: string[] = [];
  const origErr = console.error;
  const origExitCode = process.exitCode;
  console.error = (s: string) => err.push(s);
  try {
    run(["nonexistent"]);
    assert.ok(err.some((s) => s.includes("未知命令")), "应提示未知命令");
    assert.equal(process.exitCode, 1);
  } finally {
    console.error = origErr;
    process.exitCode = origExitCode; // 清理，避免污染测试运行器
  }
});
