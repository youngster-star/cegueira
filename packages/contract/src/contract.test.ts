import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTRACT_SCHEMA,
  SECURITY_ASSERTIONS,
  contractToJson,
  evalsetToJson,
  generateBundle,
  generateWithSelfCheck,
  isExecutableAcceptance,
  projectMdToMarkdown,
  rubricToYaml,
  selfCheck,
  validateContract,
  validateRubric,
  type Contract,
} from "./index.js";

test("模板生成的五件套通过自检", () => {
  const bundle = generateBundle({ direction: "RAG 问答" });
  assert.equal(selfCheck(bundle).ok, true);
});

test("generateWithSelfCheck 首次通过且不降级", () => {
  const { bundle, attempts, degraded } = generateWithSelfCheck({ direction: "RAG 问答" });
  assert.equal(attempts, 1);
  assert.equal(degraded, false);
  assert.equal(selfCheck(bundle).ok, true);
});

test("acceptance 可构造性判定", () => {
  assert.equal(isExecutableAcceptance({ type: "assert", expr: "a >= 1" }).ok, true);
  assert.equal(isExecutableAcceptance({ type: "assert" }).ok, false);
  assert.equal(isExecutableAcceptance({ type: "tool_call_in", tools: ["x"] }).ok, true);
  assert.equal(isExecutableAcceptance({ type: "tool_call_in", tools: [] }).ok, false);
  assert.equal(isExecutableAcceptance({ type: "no_loop" }).ok, true);
  assert.equal(isExecutableAcceptance({ type: "latency_lt", maxMs: 100 }).ok, true);
  assert.equal(isExecutableAcceptance({ type: "latency_lt", maxMs: 0 }).ok, false);
});

test("validateContract 拒绝 weight 未归一化", () => {
  const bundle = generateBundle({ direction: "RAG" });
  const bad: Contract = JSON.parse(JSON.stringify(bundle.contract));
  bad.stages[0].tasks[0].weight = 0.5; // 破坏归一化
  const r = validateContract(bad);
  assert.equal(r.ok, false);
});

test("validateContract 拒绝空 acceptance", () => {
  const bundle = generateBundle({ direction: "RAG" });
  const bad: Contract = JSON.parse(JSON.stringify(bundle.contract));
  bad.stages[0].tasks[0].acceptance = [];
  assert.equal(validateContract(bad).ok, false);
});

test("validateRubric 要求安全三断言齐全", () => {
  const bundle = generateBundle({ direction: "RAG" });
  assert.equal(validateRubric(bundle.rubric).ok, true);
  const bad = JSON.parse(JSON.stringify(bundle.rubric));
  bad.gates.security = ["no_prompt_leak"];
  assert.equal(validateRubric(bad).ok, false);
});

test("安全三断言常量与 rubric 一致", () => {
  const bundle = generateBundle({ direction: "RAG" });
  for (const s of SECURITY_ASSERTIONS) {
    assert.ok(bundle.rubric.gates.security.includes(s));
  }
});

test("序列化输出", () => {
  const bundle = generateBundle({ direction: "RAG 问答" });
  assert.ok(projectMdToMarkdown(bundle.projectMd).includes("# RAG 问答"));
  assert.equal(JSON.parse(contractToJson(bundle.contract)).schema, CONTRACT_SCHEMA);
  assert.ok(rubricToYaml(bundle.rubric).includes("outcome_min: 0.3"));
  assert.equal(JSON.parse(evalsetToJson(bundle.evalset)).tests.length, 2);
});

test("generateWithSelfCheck 对非法生成器降级", () => {
  const badGen = () => {
    const b = generateBundle({ direction: "RAG" });
    b.contract.stages = [];
    return b;
  };
  const { degraded, attempts } = generateWithSelfCheck({ direction: "RAG" }, 3, badGen);
  assert.equal(degraded, true);
  assert.equal(attempts, 3);
});
