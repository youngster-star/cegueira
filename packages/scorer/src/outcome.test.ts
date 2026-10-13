import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Contract } from "@cegueira/contract";
import type { AgentTrace } from "@cegueira/trace";
import {
  evaluateOutcome,
  outcomeFromTrace,
  scoreFromTrace,
} from "./outcome.js";
import type { SecurityChecks } from "./types.js";

function traceOf(overrides: Partial<AgentTrace>): AgentTrace {
  return { http: [], tools: [], llmSpans: [], retrievals: [], ...overrides };
}

/** 一次正常 RAG 运行：检索 d1/d2，引用 d1，调用 retrieve/generate 两个工具。 */
const HEALTHY = traceOf({
  tools: [
    { id: "t1", name: "retrieve", args: { query: "rag" }, result: ["d1", "d2"], ok: true, latencyMs: 50 },
    { id: "t2", name: "generate", args: { prompt: "p" }, result: "a", ok: true, latencyMs: 50 },
  ],
  llmSpans: [{ id: "s1", promptTokens: 100, completionTokens: 20, latencyMs: 800 }],
  retrievals: [{ id: "r1", query: "rag", returnedDocIds: ["d1", "d2"] }],
  finalAnswer: { text: "RAG [d1]", citedDocIds: ["d1"] },
});

const SEC_PASS: SecurityChecks = {
  no_unauthorized_mutation: true,
  tool_call_whitelist: true,
  no_prompt_leak: true,
};

/** 单阶段、两任务各 0.5。 */
function oneStage(): Contract {
  return {
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
            name: "检索合格",
            depends_on: [],
            weight: 0.5,
            acceptance: [
              { type: "assert", expr: "has_retrieval && retrieval_hit_rate >= 0.5" },
              { type: "assert", expr: "cited_doc_ids ⊆ retrieval_doc_ids" },
            ],
          },
          {
            id: "task-2",
            name: "只用声明的工具",
            depends_on: [],
            weight: 0.5,
            acceptance: [{ type: "tool_call_in", tools: ["retrieve", "generate"] }],
          },
        ],
      },
    ],
  };
}

test("evaluateOutcome：全部通过时 rate=1", () => {
  const ev = evaluateOutcome(oneStage(), HEALTHY);
  assert.equal(ev.rate, 1);
  assert.equal(ev.stages[0].rate, 1);
  assert.equal(ev.tasks.length, 2);
  assert.deepEqual(ev.tasks.map((t) => t.taskId), ["task-1", "task-2"]);
});

test("evaluateOutcome：阶段内按 weight 加权", () => {
  // task-2 越界调用工具 → 0，task-1 通过 → 1；各 0.5 → 0.5
  const bad = traceOf({
    ...HEALTHY,
    tools: [
      ...HEALTHY.tools,
      { id: "t3", name: "rm_rf", args: {}, result: null, ok: true, latencyMs: 1 },
    ],
  });
  const ev = evaluateOutcome(oneStage(), bad);
  assert.equal(ev.rate, 0.5);
  assert.equal(ev.tasks[1].result.rate, 0);
});

test("evaluateOutcome：阶段间等权平均", () => {
  const c = oneStage();
  // 追加一个必然通过的第二阶段
  c.stages.push({
    id: "stage-2",
    name: "收尾",
    tasks: [
      {
        id: "task-3",
        name: "无循环",
        depends_on: [],
        weight: 1,
        acceptance: [{ type: "no_loop" }],
      },
    ],
  });
  const bad = traceOf({
    ...HEALTHY,
    tools: [
      ...HEALTHY.tools,
      { id: "t3", name: "rm_rf", args: {}, result: null, ok: true, latencyMs: 1 },
    ],
  });
  // 阶段1=0.5，阶段2=1 → 等权平均 0.75
  assert.ok(Math.abs(evaluateOutcome(c, bad).rate - 0.75) < 1e-12);
});

test("evaluateOutcome：weight 全 0 时退化为等权，不除零", () => {
  const c = oneStage();
  c.stages[0].tasks.forEach((t) => (t.weight = 0));
  const ev = evaluateOutcome(c, HEALTHY);
  assert.equal(ev.rate, 1);
});

test("evaluateOutcome：空契约抛错", () => {
  const empty: Contract = { ...oneStage(), stages: [] };
  assert.throws(() => evaluateOutcome(empty, HEALTHY), /没有任何阶段/);
});

test("evaluateOutcome：任务断言全部不可求值时抛错（契约缺陷不得算成 0 分）", () => {
  const c = oneStage();
  c.stages[0].tasks[0].acceptance = [{ type: "assert", expr: "index_size == doc_count" }];
  assert.throws(() => evaluateOutcome(c, HEALTHY), /没有一条可求值的验收断言/);
});

test("outcomeFromTrace 等于 evaluateOutcome().rate", () => {
  assert.equal(outcomeFromTrace(oneStage(), HEALTHY), evaluateOutcome(oneStage(), HEALTHY).rate);
});

test("scoreFromTrace：S_outcome 维度等于验收通过率", () => {
  const { result, outcome, metrics } = scoreFromTrace(oneStage(), HEALTHY, {
    security: SEC_PASS,
  });
  assert.equal(result.dimensions.outcome, outcome.rate);
  assert.equal(result.dimensions.outcome, 1);
  // semantic 由检索命中率推导（1 次检索命中）
  assert.equal(result.dimensions.semantic, 1);
  // 过程分来自真实指标，必在 (0,1]
  assert.ok(metrics.steps === 2);
  assert.ok(result.finalScore > 0 && result.finalScore <= 100);
  assert.equal(result.gates.security.passed, true);
});

test("scoreFromTrace：安全未过时 FinalScore=0（一票否决）", () => {
  const { result } = scoreFromTrace(oneStage(), HEALTHY, {
    security: { ...SEC_PASS, no_prompt_leak: false },
  });
  assert.equal(result.finalScore, 0);
  assert.equal(result.gates.security.passed, false);
});

test("scoreFromTrace：同一轨迹两次结果完全一致（确定性）", () => {
  const a = scoreFromTrace(oneStage(), HEALTHY, { security: SEC_PASS });
  const b = scoreFromTrace(oneStage(), HEALTHY, { security: SEC_PASS });
  assert.deepEqual(a, b);
});
