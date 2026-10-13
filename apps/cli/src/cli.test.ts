import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "./args.js";
import { doctorCommand } from "./commands/doctor.js";
import {
  deriveSecurity,
  gradeCommand,
  loadTrace,
} from "./commands/grade.js";
import { historyCommand, recordScore } from "./commands/history.js";
import { initCommand } from "./commands/init.js";
import {
  calibrateCommand,
  parseCalibrationFile,
  renderCalibrationReport,
} from "./commands/calibrate.js";
import {
  COMPLETION_TOKEN_EST,
  defaultProviderFactory,
  parseRubricFile,
  rubricCommand,
  type ProviderFactory,
} from "./commands/rubric.js";
import { processPrivacy } from "@cegueira/privacy";
import {
  findPython,
  findRepoRoot,
  parseSummary,
  recordCommand,
  type SpawnResult,
} from "./commands/record.js";
import { collectPythonFiles, scanCommand, scanPath } from "./commands/scan.js";
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

// ---- ceg rubric：隐私预览 + 跨家族 LLM 评审 ----

function writeRubricFixture(dir: string): { rubricPath: string; artifactPath: string } {
  const rubricPath = join(dir, "rubrics.json");
  writeFileSync(
    rubricPath,
    JSON.stringify({ rubrics: [{ id: "clarity", prompt: "评估提示工程是否清晰" }] }),
  );
  const artifactPath = join(dir, "artifact.py");
  // 含一个邮箱，用于验证脱敏在预览里发生
  writeFileSync(artifactPath, "def answer(q):\n    return q  # contact dev@example.com\n");
  return { rubricPath, artifactPath };
}

test("parseRubricFile：接受数组与 {rubrics}，拒绝空与坏形状", () => {
  assert.deepEqual(parseRubricFile('[{"id":"a","prompt":"p"}]'), [{ id: "a", prompt: "p" }]);
  assert.deepEqual(parseRubricFile('{"rubrics":[{"id":"a","prompt":"p"}]}'), [
    { id: "a", prompt: "p" },
  ]);
  assert.throws(() => parseRubricFile("{}"), /数组或含 rubrics/);
  assert.throws(() => parseRubricFile("[]"), /不能为空/);
  assert.throws(() => parseRubricFile('[{"id":"a"}]'), /字符串 id 与 prompt/);
});

test("defaultProviderFactory：未知 provider 报错", () => {
  assert.throws(() => defaultProviderFactory(["bogus"], {}), /未知 LLM provider：bogus/);
});

test("rubricCommand：未 --yes 时只出外发预览，不调用 provider", async () => {
  const dir = makeTmpDir();
  try {
    const { rubricPath, artifactPath } = writeRubricFixture(dir);
    let factoryCalled = false;
    const factory: ProviderFactory = () => {
      factoryCalled = true;
      return [];
    };
    const report = await rubricCommand({ rubricPath, artifactPath }, factory);
    assert.ok(report.includes("外发预览"));
    assert.ok(report.includes("尚未外发"));
    assert.equal(factoryCalled, false, "未确认前不得调用 provider");
    // 脱敏在预览阶段就要体现
    assert.ok(report.includes("脱敏命中"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rubricCommand：--yes 后跨家族评审，逐维度取中位数", async () => {
  const dir = makeTmpDir();
  try {
    const { rubricPath, artifactPath } = writeRubricFixture(dir);
    let capturedIds: string[] = [];
    const factory: ProviderFactory = (ids) => {
      capturedIds = ids;
      return [
        { id: "famA", async chat() { return { content: '{"rating":5}' }; } }, // 1.0
        { id: "famB", async chat() { return { content: '{"rating":3}' }; } }, // 0.5
      ];
    };
    const report = await rubricCommand(
      { rubricPath, artifactPath, confirmed: true, llms: ["famA", "famB"] },
      factory,
    );
    assert.deepEqual(capturedIds, ["famA", "famB"]);
    // median(1.0, 0.5) = 0.75
    assert.ok(report.includes("0.750"));
    assert.ok(report.includes("[clarity]"));
    assert.ok(report.includes("S_rubric 维度均值"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- ceg rubric：三级预算守卫（70/90/100） ----

function rubricEstimate(artifactPath: string, items: number, providers: number): number {
  const tokenEstimate = processPrivacy(readFileSync(artifactPath, "utf8"), "review").preview.tokenEstimate;
  return items * providers * (tokenEstimate + COMPLETION_TOKEN_EST);
}

test("rubricCommand：预算 ≥100% 硬中断，不调用 provider", async () => {
  const dir = makeTmpDir();
  try {
    const { rubricPath, artifactPath } = writeRubricFixture(dir);
    let factoryCalled = false;
    const factory: ProviderFactory = () => {
      factoryCalled = true;
      return [];
    };
    const report = await rubricCommand(
      { rubricPath, artifactPath, confirmed: true, llms: ["a", "b"], budgetTokens: 1 },
      factory,
    );
    assert.ok(report.includes("硬中断"));
    assert.equal(factoryCalled, false, "硬中断后不得发起调用");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rubricCommand：预算 ≥90% 降级为单家族", async () => {
  const dir = makeTmpDir();
  try {
    const { rubricPath, artifactPath } = writeRubricFixture(dir);
    const est = rubricEstimate(artifactPath, 1, 2);
    let capturedIds: string[] = [];
    const factory: ProviderFactory = (ids) => {
      capturedIds = ids;
      return ids.map((id) => ({ id, async chat() { return { content: '{"rating":3}' }; } }));
    };
    const report = await rubricCommand(
      { rubricPath, artifactPath, confirmed: true, llms: ["famA", "famB"], budgetTokens: Math.round(est / 0.95) },
      factory,
    );
    assert.deepEqual(capturedIds, ["famA"], "降级后只保留单家族");
    assert.ok(report.includes("降级"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rubricCommand：预算 ≥70% 警告但照常跨家族", async () => {
  const dir = makeTmpDir();
  try {
    const { rubricPath, artifactPath } = writeRubricFixture(dir);
    const est = rubricEstimate(artifactPath, 1, 2);
    let capturedIds: string[] = [];
    const factory: ProviderFactory = (ids) => {
      capturedIds = ids;
      return ids.map((id) => ({ id, async chat() { return { content: '{"rating":4}' }; } }));
    };
    const report = await rubricCommand(
      { rubricPath, artifactPath, confirmed: true, llms: ["famA", "famB"], budgetTokens: Math.round(est / 0.8) },
      factory,
    );
    assert.deepEqual(capturedIds, ["famA", "famB"]);
    assert.ok(report.includes("警告"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- ceg calibrate：评分可信度校准 ----

test("parseCalibrationFile：必填 samples，校验形状", () => {
  const ok = parseCalibrationFile(
    '{"samples":[{"id":"p1","predicted":4,"human":3}],"repeated":[{"id":"p1","first":4,"second":4}]}',
  );
  assert.equal(ok.samples.length, 1);
  assert.equal(ok.repeated?.length, 1);
  assert.throws(() => parseCalibrationFile("{}"), /非空 samples/);
  assert.throws(() => parseCalibrationFile('{"samples":[]}'), /非空 samples/);
  assert.throws(() => parseCalibrationFile('{"samples":[{"id":"p1"}]}'), /id\(string\)/);
});

test("calibrateCommand：高一致样本 → QWK 高，但样本量不足不通过", () => {
  const dir = makeTmpDir();
  try {
    const labelsPath = join(dir, "labels.json");
    writeFileSync(
      labelsPath,
      JSON.stringify({
        samples: [
          { id: "p1", predicted: 3, human: 3 },
          { id: "p2", predicted: 4, human: 4 },
          { id: "p3", predicted: 5, human: 5 },
          { id: "p4", predicted: 4, human: 4 },
        ],
      }),
    );
    const report = calibrateCommand({ labelsPath });
    assert.ok(report.includes("校准报告"));
    assert.ok(report.includes("QWK"));
    assert.ok(report.includes("校准样本量不足 200 条"));
    assert.ok(report.includes("未通过"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderCalibrationReport：QWK 低于硬底线 → 明确禁用评分", () => {
  // 预测全 1、人工全 6 → QWK 应为负（远低于硬底线 0.60）
  const text = renderCalibrationReport({
    metrics: { qwk: -0.5, decisionAccuracy: 0, falseRejectRate: 1, sampleSize: 200 },
    decisionConsistency: 0.2,
    repeatStdDev: { mean: 5, max: 9 },
    checks: {
      qwk_target: false,
      qwk_hard_floor: false,
      decision_accuracy: false,
      decision_consistency: false,
      false_reject: false,
      repeat_stddev: false,
      sample_size: true,
    },
    passed: false,
    reasons: ["QWK 低于硬底线 0.60"],
  });
  assert.ok(text.includes("评分功能不启用"), "硬底线未达须明确禁用");
});

// ---- 评分落库与历史（ceg grade --store / ceg history） ----

const SCORE_RESULT = {
  dimensions: { outcome: 1, process: 0.8, semantic: 1, rubric: 0.5 },
  sCore: 0.85,
  gates: { security: { passed: true, violations: [] }, outcome: { passed: true, min: 1 } },
  finalScore: 88.5,
};

test("recordScore：写入项目快照与评分记录，重复评分 upsert 项目", () => {
  const dir = makeTmpDir();
  try {
    const store = join(dir, "data");
    const s1 = recordScore(store, GRADE_CONTRACT, SCORE_RESULT, {
      now: "2026-10-13T00:00:00.000Z",
      id: "score-1",
    });
    assert.equal(s1.projectId, GRADE_CONTRACT.project_id);
    assert.equal(s1.finalScore, 88.5);

    recordScore(store, GRADE_CONTRACT, SCORE_RESULT, {
      now: "2026-10-13T01:00:00.000Z",
      id: "score-2",
    });

    // 两条评分、一个项目（upsert 不新增；createdAt 保持首次）
    const projects = JSON.parse(readFileSync(join(store, "projects.json"), "utf8"));
    const scores = JSON.parse(readFileSync(join(store, "scores.json"), "utf8"));
    assert.equal(projects.length, 1);
    assert.equal(projects[0].createdAt, "2026-10-13T00:00:00.000Z");
    assert.equal(projects[0].updatedAt, "2026-10-13T01:00:00.000Z");
    assert.equal(scores.length, 2);

    const report = historyCommand(store);
    assert.ok(report.includes("共 2 条"));
    assert.ok(report.includes("88.5"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("historyCommand：无记录时给出明确提示", () => {
  const dir = makeTmpDir();
  try {
    assert.ok(historyCommand(join(dir, "empty")).includes("无记录"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("grade --store：报告中提示已落库，history 可查", () => {
  const dir = makeTmpDir();
  try {
    const { contractPath, runDir } = writeGradeFixture(dir, GRADE_CONTRACT, healthyTrace());
    const store = join(dir, "data");
    const report = gradeCommand(contractPath, runDir, undefined, store);
    assert.ok(report.includes("已保存评分"));
    assert.ok(historyCommand(store).includes("共 1 条"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- ceg scan：L1 静态分析 ----

/** 造一棵含可扫描文件与应被跳过目录的树。 */
function writeScanTree(dir: string): string {
  const src = join(dir, "src");
  mkdirSync(join(src, "sub"), { recursive: true });
  mkdirSync(join(src, "node_modules"), { recursive: true });
  writeFileSync(join(src, "a.py"), 'key = "sk-abcdefghijklmnop123456"\n');
  writeFileSync(join(src, "sub", "b.py"), "eval(x)\n");
  writeFileSync(join(src, "node_modules", "c.py"), "eval(y)\n");
  writeFileSync(join(src, "readme.md"), "eval(not_python)\n");
  return src;
}

test("collectPythonFiles：只收 .py，跳过 node_modules，结果排序", () => {
  const dir = makeTmpDir();
  try {
    const src = writeScanTree(dir);
    const files = collectPythonFiles(src).map((f) => f.replace(/\\/g, "/"));
    assert.equal(files.length, 2);
    assert.ok(files[0].endsWith("/src/a.py"));
    assert.ok(files[1].endsWith("/src/sub/b.py"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("collectPythonFiles：非 .py 文件不扫", () => {
  const dir = makeTmpDir();
  try {
    const md = join(dir, "x.md");
    writeFileSync(md, "eval()\n");
    assert.deepEqual(collectPythonFiles(md), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanPath：命中规则并累计加权弱点计数", () => {
  const dir = makeTmpDir();
  try {
    const { hits, weaknessScore } = scanPath(writeScanTree(dir));
    const categories = hits.map((h) => h.category).sort();
    assert.deepEqual(categories, ["dangerous_eval", "hardcoded_api_key"]);
    // high=1 (key) + high=1 (eval) = 2
    assert.equal(weaknessScore, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanCommand：报告含定位与说明；干净路径报未发现", () => {
  const dir = makeTmpDir();
  try {
    const src = writeScanTree(dir);
    const report = scanCommand(src);
    assert.ok(report.includes("hardcoded_api_key"));
    assert.ok(report.includes("dangerous_eval"));
    assert.ok(report.includes("total=2"));
    assert.ok(report.includes("不计入 FinalScore"));

    const clean = join(dir, "clean");
    mkdirSync(clean);
    writeFileSync(join(clean, "ok.py"), "def add(a, b):\n    return a + b\n");
    assert.ok(scanCommand(clean).includes("未发现"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- ceg record：Node 编排 Python 录制器 ----

test("parseSummary：取最后一行非空 JSON", () => {
  const out = 'warning line\n{"run_id":"r","run_dir":"/x","spans":2,"tool_io":1,"http":1,"has_result":true}\n\n';
  const s = parseSummary(out);
  assert.equal(s.run_id, "r");
  assert.equal(s.spans, 2);
});

test("parseSummary：空输出与坏 JSON 都报错", () => {
  assert.throws(() => parseSummary("   \n"), /没有输出摘要/);
  assert.throws(() => parseSummary("not json"), /不是合法 JSON/);
});

test("findRepoRoot：定位到含 python/runtime/cli.py 的仓库根", () => {
  const root = findRepoRoot();
  assert.ok(existsSync(join(root, "python", "runtime", "cli.py")), `未找到仓库根，得到 ${root}`);
});

test("findPython：显式优先，否则回退 PATH", () => {
  assert.equal(findPython("/whatever", "/custom/python"), "/custom/python");
  const fallback = findPython(makeTmpDir());
  assert.ok(fallback === "python" || fallback === "python3");
});

test("recordCommand：拼出正确的 Python 调用并渲染报告", () => {
  const calls: { cmd: string; args: string[]; cwd: string }[] = [];
  const fake = (cmd: string, args: string[], o: { cwd: string }): SpawnResult => {
    calls.push({ cmd, args, cwd: o.cwd });
    return {
      status: 0,
      stdout: JSON.stringify({
        run_id: "r1",
        run_dir: "/runs/1",
        spans: 3,
        tool_io: 2,
        http: 1,
        has_result: true,
      }),
      stderr: "",
    };
  };

  const report = recordCommand(
    { agentDir: "/agent", runDir: "/runs/1", python: "/py", upstream: "http://u", timeoutSec: 30, repoRoot: "/repo" },
    fake,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "/py");
  assert.equal(calls[0].cwd, "/repo");
  assert.deepEqual(calls[0].args, [
    "-m", "python.runtime.cli", "record",
    "--agent", "/agent", "--out", "/runs/1",
    "--upstream", "http://u", "--timeout", "30",
  ]);
  assert.ok(report.includes("/runs/1"));
  assert.ok(report.includes("ceg grade"));
});

test("recordCommand：子进程非零退出时抛错并带上 stderr", () => {
  const fake = (): SpawnResult => ({ status: 1, stdout: "", stderr: "boom: agent 挂了" });
  assert.throws(
    () => recordCommand({ agentDir: "/a", runDir: "/o", python: "/py", repoRoot: "/repo" }, fake),
    /录制失败（退出码 1）.*agent 挂了/s,
  );
});

test("recordCommand：无法启动子进程时报出解释器路径", () => {
  const fake = (): SpawnResult => ({ status: null, error: new Error("ENOENT") });
  assert.throws(
    () => recordCommand({ agentDir: "/a", runDir: "/o", python: "/py", repoRoot: "/repo" }, fake),
    /无法启动录制子进程（\/py）/,
  );
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
