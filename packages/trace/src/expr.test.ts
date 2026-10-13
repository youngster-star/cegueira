import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  checkExpr,
  evalExpr,
  exprIdentifiers,
  parseExpr,
  type Facts,
  type TypeTable,
} from "./expr.js";

const FACTS: Facts = {
  doc_count: 12,
  step_count: 3,
  loop_count: 0,
  latency_ms: 1200,
  success_rate: 0.95,
  retrieval_hit_rate: 0.9,
  answer_has_citation: true,
  has_retrieval: true,
  cited_doc_ids: ["d1", "d2"],
  retrieval_doc_ids: ["d1", "d2", "d3"],
};

/** 求值并断言成功，返回布尔值。 */
function bool(expr: string, facts: Facts = FACTS): boolean {
  const r = evalExpr(expr, facts);
  assert.equal(r.ok, true, `期望可求值，实际报错：${r.ok ? "" : r.reason}`);
  return (r as { ok: true; value: unknown }).value as boolean;
}

/** 求值并断言失败，返回错误原因。 */
function reason(expr: string, facts: Facts = FACTS): string {
  const r = evalExpr(expr, facts);
  assert.equal(r.ok, false, `期望报错，实际求值成功：${JSON.stringify(r)}`);
  return (r as { ok: false; reason: string }).reason;
}

// ---- 基本比较 ----

test("数字比较", () => {
  assert.equal(bool("doc_count >= 10"), true);
  assert.equal(bool("doc_count > 12"), false);
  assert.equal(bool("step_count < 5"), true);
  assert.equal(bool("latency_ms <= 1200"), true);
});

test("相等与不等：标量", () => {
  assert.equal(bool("loop_count == 0"), true);
  assert.equal(bool("loop_count != 0"), false);
  assert.equal(bool('success_rate == 0.95'), true);
});

test("相等：数组按集合语义比较，与顺序、重复无关", () => {
  assert.equal(bool('cited_doc_ids == ["d2", "d1"]'), true);
  assert.equal(bool('cited_doc_ids == ["d1", "d2", "d1"]'), true);
  assert.equal(bool('cited_doc_ids == ["d1"]'), false);
  // 元素相同但顺序不同的两份数组互不相等（长度不同）
  assert.equal(bool('cited_doc_ids != ["d1"]'), true);
});

test("布尔标识符可直接作为断言", () => {
  assert.equal(bool("answer_has_citation"), true);
  assert.equal(bool("!answer_has_citation"), false);
});

test("逻辑组合 && / || / !", () => {
  assert.equal(bool("has_retrieval && answer_has_citation"), true);
  assert.equal(bool("loop_count > 0 || doc_count >= 10"), true);
  assert.equal(bool("loop_count > 0 && doc_count >= 10"), false);
  assert.equal(bool("!(loop_count > 0)"), true);
});

test("括号改变优先级：&& 先于 ||", () => {
  assert.equal(bool("loop_count > 0 && doc_count > 0 || answer_has_citation"), true);
  assert.equal(bool("loop_count > 0 && (doc_count > 0 || answer_has_citation)"), false);
});

// ---- 集合运算 ----

test("⊆ 子集：引用必须全部出自检索结果", () => {
  assert.equal(bool("cited_doc_ids ⊆ retrieval_doc_ids"), true);
  assert.equal(bool("retrieval_doc_ids ⊆ cited_doc_ids"), false);
});

test("⊇ 超集", () => {
  assert.equal(bool("retrieval_doc_ids ⊇ cited_doc_ids"), true);
  assert.equal(bool("cited_doc_ids ⊇ retrieval_doc_ids"), false);
});

test("∈ / ∉ 成员判定", () => {
  assert.equal(bool('"d1" ∈ cited_doc_ids'), true);
  assert.equal(bool('"d9" ∈ cited_doc_ids'), false);
  assert.equal(bool('"d9" ∉ cited_doc_ids'), true);
});

test("集合运算可组合", () => {
  assert.equal(bool('cited_doc_ids ⊆ retrieval_doc_ids && "d3" ∈ retrieval_doc_ids'), true);
});

// ---- 必须报错的情形（一律报错，绝不静默判 false） ----

test("自然语言句子必须被拒绝（这是 PRD §6.3 的水分所在）", () => {
  const r = reason("cited_doc_ids 全部来自检索结果");
  assert.match(r, /多余内容|不允许的字符/);
});

test("未识别的标识符必须被拒绝，并指出名字", () => {
  // index_size 是旧模板里真实出现过的、词汇表中并不存在的标识符
  assert.match(reason("index_size == doc_count"), /未识别的标识符 index_size/);
  assert.match(reason("foo >= 1"), /未识别的标识符 foo/);
});

test("原型链上的属性名不算已知标识符", () => {
  // 用 hasOwnProperty.call 而非 in，避免 constructor/__proto__ 被当成合法事实
  for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.match(reason(`${name} == 1`), /未识别的标识符/);
  }
});

test("类型不符必须报错，不能被当成 false", () => {
  assert.match(reason("doc_count ⊆ cited_doc_ids"), /必须是字符串数组/);
  assert.match(reason("cited_doc_ids > 1"), /必须是数字/);
  assert.match(reason("doc_count && answer_has_citation"), /必须是布尔值/);
  assert.match(reason('1 ∈ doc_count'), /必须是字符串数组/);
  assert.match(reason("!doc_count"), /必须是布尔值/);
});

test("顶层结果必须是布尔值", () => {
  assert.match(reason("doc_count"), /必须是布尔值/);
  assert.match(reason("cited_doc_ids"), /必须是布尔值/);
});

test("链式比较被拒绝", () => {
  assert.match(reason("1 < doc_count < 20"), /链式比较/);
});

test("语法错误必须报错并带位置", () => {
  assert.match(reason("doc_count >="), /意外结束/);
  assert.match(reason("doc_count >= 10)"), /多余内容|意外/);
  assert.match(reason("(doc_count >= 10"), /缺少 \)/);
  assert.match(reason(""), /表达式为空/);
  assert.match(reason("doc_count $ 1"), /不允许的字符/);
});

test("不支持任意函数调用与代码注入", () => {
  // 不是 eval：标识符后跟 ( 会语法报错；带点的成员访问会在词法阶段被拒
  assert.equal(parseExpr("process.exit(1)").ok, false);
  assert.equal(parseExpr("require('fs')").ok, false);
  assert.equal(parseExpr("doc_count.constructor").ok, false);
  assert.equal(parseExpr("[].map").ok, false);
  // 分号不是合法字符
  assert.equal(parseExpr("1; 2").ok, false);
});

test("字符串字面量与转义", () => {
  assert.equal(bool('"d1" ∈ cited_doc_ids'), true);
  // 含转义引号的字符串不会命中任何文档 id
  assert.equal(bool('"d\\"1" ∈ cited_doc_ids'), false);
  assert.equal(parseExpr('"未闭合').ok, false);
  // 只支持 \" 与 \\ 两种转义，其余一律报错（不猜测、不放行）
  assert.equal(parseExpr('"a\\nb"').ok, false);
});

test("负数与小数", () => {
  const facts: Facts = { x: -5, y: 1.5 };
  assert.equal(bool("x < 0", facts), true);
  assert.equal(bool("y > 1.4", facts), true);
  assert.equal(bool("x >= -5", facts), true);
  assert.equal(parseExpr("x > -").ok, false);
});

test("空数组与空集合判定", () => {
  const facts: Facts = { cited_doc_ids: [] as string[], retrieval_doc_ids: ["d1"] };
  assert.equal(bool("cited_doc_ids ⊆ retrieval_doc_ids", facts), true);
  assert.equal(bool("cited_doc_ids == []", facts), true);
});

// ---- 标识符收集与可求值性检查 ----

test("exprIdentifiers 收集全部标识符（去重、不含字面量）", () => {
  const p = parseExpr('cited_doc_ids ⊆ retrieval_doc_ids && doc_count >= 10 && "d1" ∈ cited_doc_ids');
  assert.equal(p.ok, true);
  const names = exprIdentifiers((p as { ok: true; ast: never }).ast).sort();
  assert.deepEqual(names, ["cited_doc_ids", "doc_count", "retrieval_doc_ids"]);
});

// ---- 静态可求值性检查（契约校验期，无值） ----

/** 校验期使用的类型表。键集合即白名单。 */
const TYPES: TypeTable = {
  doc_count: "number",
  latency_ms: "number",
  answer_has_citation: "boolean",
  cited_doc_ids: "string_array",
  retrieval_doc_ids: "string_array",
};

/** 断言 checkExpr 失败，返回原因。 */
function reject(expr: string, types: TypeTable = TYPES): string {
  const r = checkExpr(expr, types);
  assert.equal(r.ok, false, `期望不可求值，实际通过：${expr}`);
  return (r as { ok: false; reason: string }).reason;
}

test("checkExpr 通过：语法正确、标识符命中、类型自洽、顶层为布尔", () => {
  assert.deepEqual(checkExpr("cited_doc_ids ⊆ retrieval_doc_ids", TYPES), { ok: true });
  assert.deepEqual(checkExpr("doc_count >= 10", TYPES), { ok: true });
  assert.deepEqual(checkExpr("answer_has_citation", TYPES), { ok: true });
  assert.deepEqual(checkExpr("!answer_has_citation", TYPES), { ok: true });
  assert.deepEqual(
    checkExpr('has_retrieval_ok || "d1" ∈ cited_doc_ids', { ...TYPES, has_retrieval_ok: "boolean" }),
    { ok: true },
  );
  assert.deepEqual(checkExpr('cited_doc_ids == ["d1", "d2"]', TYPES), { ok: true });
});

test("checkExpr 拒绝语法错误，不需要值", () => {
  assert.match(reject("cited_doc_ids 全部来自检索结果"), /多余内容|不允许的字符/);
  assert.match(reject("doc_count >="), /意外结束/);
});

test("checkExpr 拒绝未识别标识符", () => {
  assert.match(reject("index_size == doc_count"), /未识别的标识符 index_size/);
  assert.match(reject("constructor == 1"), /未识别的标识符 constructor/);
});

test("checkExpr 拒绝类型不符——这类断言语法与标识符都合法，只在求值时才炸", () => {
  // 这四条都是旧校验器（只查非空字符串 / 只查标识符）放得过去的
  assert.match(reject("doc_count ⊆ cited_doc_ids"), /⊆ 两边都必须是字符串数组/);
  assert.match(reject("cited_doc_ids > 1"), /> 两边都必须是数字/);
  assert.match(reject("doc_count && answer_has_citation"), /&& 两边都必须是布尔值/);
  assert.match(reject("doc_count == cited_doc_ids"), /== 两边类型必须一致/);
  assert.match(reject("!doc_count"), /! 的操作数必须是布尔值/);
});

test("checkExpr 要求顶层是布尔——漏写比较符是最常见的手误", () => {
  assert.match(reject("doc_count"), /顶层结果必须是布尔值（实际 数字）/);
  assert.match(reject("cited_doc_ids"), /顶层结果必须是布尔值（实际 字符串数组）/);
});
