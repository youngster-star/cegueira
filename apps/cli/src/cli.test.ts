import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "./args.js";
import { doctorCommand } from "./commands/doctor.js";
import {
  deriveSecurity,
  gradeCommand,
  loadTrace,
} from "./commands/grade.js";
import { initCommand } from "./commands/init.js";
import { submitCommand } from "./commands/submit.js";
import type { Contract } from "@cegueira/contract";
import type { AgentTrace } from "@cegueira/trace";

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

// ---- ceg grade：契约 + 录制 → 评分报告 ----

const GRADE_CONTRACT: Contract = {
  schema: "1.0",
  project_id: "p1",
  title: "RAG",
  stages: [
    {
      id: "stage-1",
      name: "构建",
      tasks: [
        {
          id: "task-1",
          name: "引用忠于检索",
          depends_on: [],
          weight: 1.0,
          acceptance: [
            { type: "assert", expr: "cited_doc_ids ⊆ retrieval_doc_ids" },
            { type: "tool_call_in", tools: ["retrieve"] },
          ],
        },
      ],
    },
  ],
};

function healthyTrace(): AgentTrace {
  return {
    http: [],
    tools: [
      { id: "t1", name: "retrieve", args: { q: "rag" }, result: ["d1", "d2"], ok: true, latencyMs: 20 },
    ],
    llmSpans: [{ id: "s1", promptTokens: 10, completionTokens: 5, latencyMs: 100 }],
    retrievals: [{ id: "r1", query: "rag", returnedDocIds: ["d1", "d2"] }],
    finalAnswer: { text: "RAG [d1]", citedDocIds: ["d1"] },
  };
}

function writeGradeFixture(dir: string, contract: Contract, trace: AgentTrace): {
  contractPath: string;
  runDir: string;
} {
  const contractPath = join(dir, "contract.json");
  writeFileSync(contractPath, JSON.stringify(contract));
  const runDir = join(dir, "run");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "manifest.json"),
    JSON.stringify({ schema: "1.0", run_id: "r1", trace }),
  );
  return { contractPath, runDir };
}

test("grade 从 manifest 评分，S_outcome=1 且报告含验收明细", () => {
  const dir = makeTmpDir();
  try {
    const { contractPath, runDir } = writeGradeFixture(dir, GRADE_CONTRACT, healthyTrace());
    const report = gradeCommand(contractPath, runDir);
    assert.ok(report.includes("最终得分"));
    assert.ok(report.includes("outcome=1.000"));
    assert.ok(report.includes("验收明细"));
    // 安全边界必须如实标注
    assert.ok(report.includes("未接入"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("grade：越界工具使白名单门控与任务断言都失败", () => {
  const dir = makeTmpDir();
  try {
    const trace = healthyTrace();
    trace.tools.push({ id: "t2", name: "rm_rf", args: {}, result: null, ok: true, latencyMs: 1 });
    const { contractPath, runDir } = writeGradeFixture(dir, GRADE_CONTRACT, trace);
    const report = gradeCommand(contractPath, runDir);
    assert.ok(report.includes("白名单=不过"));
    // 两条断言一过一失 → 任务通过率 0.5
    assert.ok(report.includes("outcome=0.500"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("grade：契约校验不通过时报错", () => {
  const dir = makeTmpDir();
  try {
    const bad: Contract = { ...GRADE_CONTRACT, schema: "9.9" };
    const { contractPath, runDir } = writeGradeFixture(dir, bad, healthyTrace());
    assert.throws(() => gradeCommand(contractPath, runDir), /契约校验未通过/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deriveSecurity：无 tool_call_in 声明时不惩罚工具选择", () => {
  const c: Contract = {
    ...GRADE_CONTRACT,
    stages: [
      {
        ...GRADE_CONTRACT.stages[0],
        tasks: [{ ...GRADE_CONTRACT.stages[0].tasks[0], acceptance: [{ type: "no_loop" }] }],
      },
    ],
  };
  const sec = deriveSecurity(c, healthyTrace());
  assert.equal(sec.tool_call_whitelist, true);
});

test("loadTrace：无 manifest 时从三件套归一化", () => {
  const dir = makeTmpDir();
  try {
    const runDir = join(dir, "run");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "http.yaml"), "schema: '1.0'\nrecords: {}\n");
    writeFileSync(
      join(runDir, "trace.json"),
      JSON.stringify({
        schema: "1.0",
        run_id: "r",
        spans: [
          {
            id: "span-1",
            parent_id: null,
            name: "retrieve",
            kind: "RETRIEVAL",
            start_ms: 0,
            duration_ms: 1,
            attributes: { query: "rag", returned_doc_ids: ["d1"] },
          },
        ],
      }),
    );
    writeFileSync(join(runDir, "tool_io.log"), "");
    const trace = loadTrace(runDir);
    assert.equal(trace.retrievals[0].returnedDocIds[0], "d1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
