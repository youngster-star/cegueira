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

test("生成的契约：tool_call_in 可被正常 Agent 同时满足（单轨迹全局白名单）", () => {
  const c = generateBundle({ direction: "RAG 问答" }).contract;
  const lists: Set<string>[] = [];
  for (const st of c.stages) {
    for (const t of st.tasks) {
      for (const a of t.acceptance) {
        if (a.type === "tool_call_in" && a.tools) lists.push(new Set(a.tools));
      }
    }
  }
  assert.ok(lists.length >= 1, "模板应至少声明一份工具白名单");
  // 关键性质：存在一个工具集合（全流程工具）能同时满足所有 tool_call_in。
  // 否则任何用了工具的 Agent 都会违反其一，只有空轨迹才能空洞全过。
  const usedTools = ["chunk", "embed", "index", "retrieve", "generate"];
  for (const list of lists) {
    for (const tool of usedTools) {
      assert.ok(list.has(tool), `${tool} 应落在每份 tool_call_in 白名单内`);
    }
  }
});

test("acceptance 可构造性判定", () => {
  assert.equal(isExecutableAcceptance({ type: "assert", expr: "doc_count >= 1" }).ok, true);
  assert.equal(isExecutableAcceptance({ type: "assert" }).ok, false);
  assert.equal(isExecutableAcceptance({ type: "tool_call_in", tools: ["x"] }).ok, true);
  assert.equal(isExecutableAcceptance({ type: "tool_call_in", tools: [] }).ok, false);
  assert.equal(isExecutableAcceptance({ type: "no_loop" }).ok, true);
  assert.equal(isExecutableAcceptance({ type: "latency_lt", maxMs: 100 }).ok, true);
  assert.equal(isExecutableAcceptance({ type: "latency_lt", maxMs: 0 }).ok, false);
});

test("acceptance 可构造性判定：表达式必须真可求值（PRD §6.3）", () => {
  /** 取失败原因，顺带断言确实失败了。 */
  const why = (expr: string): string => {
    const r = isExecutableAcceptance({ type: "assert", expr });
    assert.equal(r.ok, false, `期望判为不可求值，实际通过：${expr}`);
    return (r as { ok: false; reason: string }).reason;
  };

  // 自然语言句子：旧校验只判断「非空字符串」时能通过，评分时永远无法求值
  assert.match(why("cited_doc_ids 全部来自检索结果"), /不可求值/);
  // 不存在的标识符：旧模板里真实出现过（index_size）
  assert.match(why("index_size == doc_count"), /未识别的标识符 index_size/);
  // 类型不符：语法与标识符都合法，只在求值时才炸
  assert.match(why("doc_count ⊆ cited_doc_ids"), /必须是字符串数组/);
  // 漏写比较符
  assert.match(why("doc_count"), /顶层结果必须是布尔值/);

  // 词汇表内且类型自洽的表达式必须通过
  assert.equal(isExecutableAcceptance({ type: "assert", expr: "cited_doc_ids ⊆ retrieval_doc_ids" }).ok, true);
  assert.equal(isExecutableAcceptance({ type: "assert", expr: "has_retrieval && retrieval_hit_rate >= 0.9" }).ok, true);
  assert.equal(isExecutableAcceptance({ type: "assert", expr: "!answer_has_citation" }).ok, true);
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
