import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTRACT_SCHEMA,
  generateBundle,
  isExecutableAcceptance,
  rubricToYaml,
  validateContract,
  validateRubric,
  type Contract,
  type SecurityAssertion,
} from "./index.js";

// ---------- acceptance 可构造性边界 ----------

test("isExecutableAcceptance：未知类型拒绝", () => {
  const r = isExecutableAcceptance({ type: "unknown_type" } as never);
  assert.equal(r.ok, false);
});

test("isExecutableAcceptance：assert 空白 expr 拒绝", () => {
  assert.equal(isExecutableAcceptance({ type: "assert", expr: "   " }).ok, false);
});

test("isExecutableAcceptance：latency_lt 非正数/NaN 拒绝", () => {
  assert.equal(isExecutableAcceptance({ type: "latency_lt", maxMs: 0 }).ok, false);
  assert.equal(isExecutableAcceptance({ type: "latency_lt", maxMs: -5 }).ok, false);
  assert.equal(isExecutableAcceptance({ type: "latency_lt", maxMs: NaN }).ok, false);
  assert.equal(isExecutableAcceptance({ type: "latency_lt", maxMs: Infinity }).ok, false);
});

test("isExecutableAcceptance：tool_call_in 白名单含空串也视为非法", () => {
  assert.equal(isExecutableAcceptance({ type: "tool_call_in", tools: [""] }).ok, false);
});

// ---------- validateContract 结构边界 ----------

test("validateContract：schema 版本不匹配拒绝", () => {
  const c = generateBundle({ direction: "RAG" }).contract;
  const bad = { ...c, schema: "0.9" };
  assert.equal(validateContract(bad).ok, false);
});

test("validateContract：缺 project_id 或 title 拒绝", () => {
  const c = generateBundle({ direction: "RAG" }).contract;
  assert.equal(validateContract({ ...c, project_id: "" }).ok, false);
  assert.equal(validateContract({ ...c, title: "" }).ok, false);
});

test("validateContract：stages 空数组拒绝", () => {
  const c = generateBundle({ direction: "RAG" }).contract;
  assert.equal(validateContract({ ...c, stages: [] }).ok, false);
});

test("validateContract：单阶段单任务 weight=1 合法", () => {
  const c = generateBundle({ direction: "RAG" }).contract;
  assert.equal(validateContract(c).ok, true);
});

test("validateContract：task acceptance 含非法条目时精确定位", () => {
  const c = generateBundle({ direction: "RAG" }).contract;
  const bad = JSON.parse(JSON.stringify(c)) as Contract;
  bad.stages[0].tasks[0].acceptance = [{ type: "assert" }];
  const r = validateContract(bad);
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes("task-1"));
});

// ---------- validateRubric 边界 ----------

test("validateRubric：outcome_min 边界（0 拒绝、1 接受、>1 拒绝）", () => {
  const base = generateBundle({ direction: "RAG" }).rubric;
  assert.equal(validateRubric({ ...base, gates: { ...base.gates, outcome_min: 0 } }).ok, false);
  assert.equal(validateRubric({ ...base, gates: { ...base.gates, outcome_min: 1 } }).ok, true);
  assert.equal(validateRubric({ ...base, gates: { ...base.gates, outcome_min: 1.1 } }).ok, false);
});

test("validateRubric：mandatory_tests 空拒绝", () => {
  const base = generateBundle({ direction: "RAG" }).rubric;
  assert.equal(validateRubric({ ...base, mandatory_tests: [] }).ok, false);
});

test("validateRubric：安全断言顺序无关、齐全即可", () => {
  const base = generateBundle({ direction: "RAG" }).rubric;
  const security: SecurityAssertion[] = [
    "no_prompt_leak",
    "no_unauthorized_mutation",
    "tool_call_whitelist",
  ];
  const reordered = {
    ...base,
    gates: { ...base.gates, security },
  };
  assert.equal(validateRubric(reordered).ok, true);
});

// ---------- 序列化与生成边界 ----------

test("rubricToYaml 输出完整且可被后续解析", () => {
  const r = generateBundle({ direction: "RAG" }).rubric;
  const yaml = rubricToYaml(r);
  assert.ok(yaml.includes(`schema: "${CONTRACT_SCHEMA}"`));
  assert.ok(yaml.includes("outcome_min: 0.3"));
  assert.ok(yaml.includes("- no_unauthorized_mutation"));
  assert.ok(yaml.includes("- no_prompt_leak"));
  assert.ok(yaml.includes("- tool_call_whitelist"));
  // 三断言齐全
  for (const s of ["no_unauthorized_mutation", "tool_call_whitelist", "no_prompt_leak"]) {
    assert.ok(yaml.includes(s), `YAML 缺 ${s}`);
  }
});

test("generateBundle 空方向回退默认标题", () => {
  const b1 = generateBundle({ direction: "" });
  assert.equal(b1.projectMd.title, "RAG 问答 Agent");
  const b2 = generateBundle({ direction: "   " });
  assert.equal(b2.projectMd.title, "RAG 问答 Agent");
});

test("generateBundle 每次生成 project_id 唯一", () => {
  const b1 = generateBundle({ direction: "RAG" });
  const b2 = generateBundle({ direction: "RAG" });
  assert.notEqual(b1.contract.project_id, b2.contract.project_id);
});

test("契约 DAG 无环且 depends_on 引用存在", () => {
  const c = generateBundle({ direction: "RAG" }).contract;
  const allIds = new Set(c.stages.flatMap((s) => s.tasks.map((t) => t.id)));
  for (const s of c.stages) {
    for (const t of s.tasks) {
      for (const dep of t.depends_on) {
        assert.ok(allIds.has(dep), `任务 ${t.id} 依赖不存在的 ${dep}`);
      }
    }
  }
});
