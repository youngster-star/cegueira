/**
 * 受限表达式求值器（A1）。
 *
 * 契约里的 assert 表达式最终要对着轨迹求值，因此本模块处理的是**不可信输入**
 * ——契约可能由 LLM 生成，也可能被用户手改。三条硬约束：
 *
 *   1. **绝不使用 eval / new Function**：手写递归下降解析器，文法固定且极小；
 *   2. **标识符必须在调用方给定的白名单内**，未识别即报错；
 *   3. **任何解析失败、未识别标识符、类型不符，一律返回错误，绝不静默判定为 false**。
 *
 * 第 3 条与 docs/常见错误与坑.md §2「未命中一律报错，绝不降级」同源：
 * 把一条写错的断言静默当成 false，会让「契约写错了」表现为「Agent 没做到」，
 * 是错误归因，比直接报错危险得多。
 */

/** 表达式可产生与可消费的值类型。刻意不含对象与 null——契约断言用不到，缩小攻击面。 */
export type ExprValue = number | string | boolean | string[];

/** 表达式的静态类型标签，与 ExprValue 一一对应。 */
export type ExprType = "number" | "string" | "boolean" | "string_array";

/** 标识符的静态类型表。键集合即白名单。 */
export type TypeTable = Readonly<Record<string, ExprType>>;

/** 标识符 → 值。由调用方（facts.ts）提供，求值器本身不认识任何业务字段。 */
export type Facts = Record<string, ExprValue>;

export type EvalResult = { ok: true; value: ExprValue } | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// 词法
// ---------------------------------------------------------------------------

type TokenType = "num" | "str" | "ident" | "op" | "eof";

interface Token {
  type: TokenType;
  text: string;
  /** 在源串中的起始下标，用于报错定位。 */
  pos: number;
  /** 仅 num 有效。 */
  num?: number;
}

/** 运算符表。**必须按长度降序**，否则 `<=` 会被先匹配成 `<`。 */
const OPERATORS = [
  "<=",
  ">=",
  "==",
  "!=",
  "&&",
  "||",
  // 集合运算符：⊆ 子集、⊇ 超集、∈ 属于、∉ 不属于
  "⊆",
  "⊇",
  "∈",
  "∉",
  ">",
  "<",
  "!",
  "(",
  ")",
  "[",
  "]",
  ",",
] as const;

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

function isIdentStart(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
}

function isIdentPart(c: string): boolean {
  return isIdentStart(c) || isDigit(c);
}

class Lexer {
  private i = 0;
  constructor(private readonly src: string) {}

  tokenize(): { ok: true; tokens: Token[] } | { ok: false; reason: string } {
    const tokens: Token[] = [];
    // 负号只在「前面是运算符 / 开头 / 左括号 / 逗号」时作为数字字面量的一部分，
    // 否则它不是一个合法字符（本求值器不提供二元减法）。
    let allowSign = true;

    while (this.i < this.src.length) {
      const c = this.src[this.i];

      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        this.i++;
        continue;
      }

      if (c === "-" && allowSign) {
        const start = this.i;
        this.i++;
        if (this.i >= this.src.length || !isDigit(this.src[this.i])) {
          return { ok: false, reason: `位置 ${start}: "-" 后应为数字` };
        }
        const { text, value } = this.readNumber(start);
        tokens.push({ type: "num", text, pos: start, num: value });
        allowSign = false;
        continue;
      }

      if (isDigit(c)) {
        const start = this.i;
        const { text, value } = this.readNumber(start);
        tokens.push({ type: "num", text, pos: start, num: value });
        allowSign = false;
        continue;
      }

      if (c === '"' || c === "'") {
        const start = this.i;
        const read = this.readString(c);
        if (!read.ok) return read;
        tokens.push({ type: "str", text: read.value, pos: start });
        allowSign = false;
        continue;
      }

      if (isIdentStart(c)) {
        const start = this.i;
        while (this.i < this.src.length && isIdentPart(this.src[this.i])) this.i++;
        tokens.push({ type: "ident", text: this.src.slice(start, this.i), pos: start });
        allowSign = false;
        continue;
      }

      const op = OPERATORS.find((o) => this.src.startsWith(o, this.i));
      if (op) {
        tokens.push({ type: "op", text: op, pos: this.i });
        this.i += op.length;
        allowSign = op !== ")" && op !== "]";
        continue;
      }

      return { ok: false, reason: `位置 ${this.i}: 不允许的字符 ${JSON.stringify(c)}` };
    }

    tokens.push({ type: "eof", text: "", pos: this.src.length });
    return { ok: true, tokens };
  }

  private readNumber(start: number): { text: string; value: number } {
    while (this.i < this.src.length && isDigit(this.src[this.i])) this.i++;
    if (this.i < this.src.length && this.src[this.i] === ".") {
      this.i++;
      while (this.i < this.src.length && isDigit(this.src[this.i])) this.i++;
    }
    const text = this.src.slice(start, this.i);
    return { text, value: Number(text) };
  }

  private readString(quote: string): { ok: true; value: string } | { ok: false; reason: string } {
    const start = this.i;
    this.i++; // 跳过开引号
    let out = "";
    while (this.i < this.src.length) {
      const c = this.src[this.i];
      if (c === "\\") {
        const next = this.src[this.i + 1];
        if (next === quote || next === "\\") {
          out += next;
          this.i += 2;
          continue;
        }
        return { ok: false, reason: `位置 ${this.i}: 不支持的转义 \\${next ?? ""}` };
      }
      if (c === quote) {
        this.i++;
        return { ok: true, value: out };
      }
      out += c;
      this.i++;
    }
    return { ok: false, reason: `位置 ${start}: 字符串未闭合` };
  }
}

// ---------------------------------------------------------------------------
// 语法（AST）
// ---------------------------------------------------------------------------

type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "ident"; name: string; pos: number }
  | { k: "arr"; items: Node[] }
  | { k: "not"; x: Node }
  | { k: "bin"; op: string; l: Node; r: Node; pos: number };

/** 比较运算符（非结合，不允许 `a < b < c` 这类链式写法）。 */
const COMPARE_OPS = new Set(["==", "!=", ">", "<", ">=", "<=", "⊆", "⊇", "∈", "∉"]);

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  /** or := and ("||" and)* */
  parseOr(): Node {
    let left = this.parseAnd();
    while (this.peekOp("||")) {
      this.next();
      left = { k: "bin", op: "||", l: left, r: this.parseAnd(), pos: 0 };
    }
    return left;
  }

  /** and := cmp ("&&" cmp)* */
  parseAnd(): Node {
    let left = this.parseCompare();
    while (this.peekOp("&&")) {
      this.next();
      left = { k: "bin", op: "&&", l: left, r: this.parseCompare(), pos: 0 };
    }
    return left;
  }

  /** cmp := unary [ cmpOp unary ] —— 最多一次比较，拒绝链式。 */
  parseCompare(): Node {
    const left = this.parseUnary();
    const t = this.peek();
    if (t.type === "op" && COMPARE_OPS.has(t.text)) {
      this.next();
      const right = this.parseUnary();
      const after = this.peek();
      if (after.type === "op" && COMPARE_OPS.has(after.text)) {
        throw new ExprSyntaxError(`位置 ${after.pos}: 不支持链式比较，请用 && 拆开`);
      }
      return { k: "bin", op: t.text, l: left, r: right, pos: t.pos };
    }
    return left;
  }

  /** unary := "!" unary | primary */
  parseUnary(): Node {
    if (this.peekOp("!")) {
      this.next();
      return { k: "not", x: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  /** primary := num | str | ident | "(" or ")" | array */
  parsePrimary(): Node {
    const t = this.next();
    switch (t.type) {
      case "num":
        return { k: "num", v: t.num as number };
      case "str":
        return { k: "str", v: t.text };
      case "ident":
        return { k: "ident", name: t.text, pos: t.pos };
      case "op":
        if (t.text === "(") {
          const inner = this.parseOr();
          this.expectOp(")");
          return inner;
        }
        if (t.text === "[") return this.parseArray();
        break;
      default:
        break;
    }
    throw new ExprSyntaxError(
      t.type === "eof" ? "表达式意外结束" : `位置 ${t.pos}: 意外的 ${JSON.stringify(t.text)}`,
    );
  }

  /** array := "[" [ value ("," value)* ] "]" */
  private parseArray(): Node {
    const items: Node[] = [];
    if (this.peekOp("]")) {
      this.next();
      return { k: "arr", items };
    }
    for (;;) {
      items.push(this.parseUnary());
      if (this.peekOp(",")) {
        this.next();
        continue;
      }
      break;
    }
    this.expectOp("]");
    return { k: "arr", items };
  }

  private peek(): Token {
    return this.tokens[this.i];
  }

  private peekOp(op: string): boolean {
    const t = this.peek();
    return t.type === "op" && t.text === op;
  }

  /** 是否已消费完全部 token（只剩 eof）。 */
  atEnd(): boolean {
    return this.i >= this.tokens.length || this.tokens[this.i].type === "eof";
  }

  /** 当前 token 的源串位置，用于「表达式有多余内容」的报错。 */
  currentPos(): number {
    return this.i < this.tokens.length ? this.tokens[this.i].pos : -1;
  }

  private next(): Token {
    return this.tokens[this.i++];
  }

  private expectOp(op: string): void {
    const t = this.next();
    if (t.type !== "op" || t.text !== op) {
      throw new ExprSyntaxError(
        t.type === "eof" ? `缺少 ${op}` : `位置 ${t.pos}: 期望 ${op}，实际 ${JSON.stringify(t.text)}`,
      );
    }
  }
}

/** 语法错误。仅在 parse 内部抛出，出口统一转成 { ok: false }。 */
class ExprSyntaxError extends Error {}

/** 解析表达式，得到 AST。不涉及任何标识符解析或求值。 */
export function parseExpr(src: string): { ok: true; ast: Node } | { ok: false; reason: string } {
  if (typeof src !== "string" || src.trim().length === 0) {
    return { ok: false, reason: "表达式为空" };
  }
  const lexed = new Lexer(src).tokenize();
  if (!lexed.ok) return lexed;
  try {
    const parser = new Parser(lexed.tokens);
    const ast = parser.parseOr();
    // parseOr 结束后必须只剩 eof，否则说明有多余内容（如 "a >= 1 2"）。
    if (!parser.atEnd()) {
      return { ok: false, reason: `位置 ${parser.currentPos()}: 表达式有多余内容` };
    }
    return { ok: true, ast };
  } catch (e) {
    if (e instanceof ExprSyntaxError) return { ok: false, reason: e.message };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 求值
// ---------------------------------------------------------------------------

function isStringArray(v: ExprValue): v is string[] {
  return Array.isArray(v);
}

/**
 * 集合语义下的数组相等：顺序无关、重复无关。
 * 不能先比较 `a.length !== b.length`——那样 `["d1","d2"] == ["d1","d2","d1"]` 会被判为不等。
 */
function sameStringSet(a: string[], b: string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

function scalarEqual(a: ExprValue, b: ExprValue): boolean {
  if (isStringArray(a) || isStringArray(b)) return false;
  return a === b;
}

function compareOrder(op: string, a: ExprValue, b: ExprValue): EvalResult {
  if (typeof a !== "number" || typeof b !== "number") {
    return { ok: false, reason: `${op} 两边都必须是数字（实际 ${typeName(a)} 与 ${typeName(b)}）` };
  }
  switch (op) {
    case ">":
      return { ok: true, value: a > b };
    case "<":
      return { ok: true, value: a < b };
    case ">=":
      return { ok: true, value: a >= b };
    default:
      return { ok: true, value: a <= b };
  }
}

function typeName(v: ExprValue): string {
  if (isStringArray(v)) return "字符串数组";
  if (typeof v === "number") return "数字";
  if (typeof v === "boolean") return "布尔值";
  return "字符串";
}

function evalBin(op: string, l: ExprValue, r: ExprValue): EvalResult {
  switch (op) {
    case "&&":
    case "||": {
      if (typeof l !== "boolean" || typeof r !== "boolean") {
        return { ok: false, reason: `${op} 两边都必须是布尔值（实际 ${typeName(l)} 与 ${typeName(r)}）` };
      }
      return { ok: true, value: op === "&&" ? l && r : l || r };
    }
    case "==":
    case "!=": {
      const eq = isStringArray(l) && isStringArray(r) ? sameStringSet(l, r) : scalarEqual(l, r);
      return { ok: true, value: op === "==" ? eq : !eq };
    }
    case ">":
    case "<":
    case ">=":
    case "<=":
      return compareOrder(op, l, r);
    case "⊆":
    case "⊇": {
      if (!isStringArray(l) || !isStringArray(r)) {
        return { ok: false, reason: `${op} 两边都必须是字符串数组（实际 ${typeName(l)} 与 ${typeName(r)}）` };
      }
      const [sub, sup] = op === "⊆" ? [l, r] : [r, l];
      const supSet = new Set(sup);
      return { ok: true, value: sub.every((x) => supSet.has(x)) };
    }
    case "∈":
    case "∉": {
      // 读作「左 ∈ 右」：左边是字符串标量，右边是字符串集合。
      if (isStringArray(l) || typeof l !== "string" || !isStringArray(r)) {
        return {
          ok: false,
          reason: `${op} 左边必须是字符串、右边必须是字符串数组（实际 ${typeName(l)} 与 ${typeName(r)}）`,
        };
      }
      const has = r.includes(l);
      return { ok: true, value: op === "∈" ? has : !has };
    }
    default:
      return { ok: false, reason: `不支持的运算符 ${op}` };
  }
}

function evalNode(n: Node, facts: Facts): EvalResult {
  switch (n.k) {
    case "num":
      return { ok: true, value: n.v };
    case "str":
      return { ok: true, value: n.v };
    case "arr": {
      const out: string[] = [];
      for (const item of n.items) {
        const r = evalNode(item, facts);
        if (!r.ok) return r;
        if (typeof r.value !== "string") {
          return { ok: false, reason: `数组元素必须是字符串（实际 ${typeName(r.value)}）` };
        }
        out.push(r.value);
      }
      return { ok: true, value: out };
    }
    case "not": {
      const r = evalNode(n.x, facts);
      if (!r.ok) return r;
      if (typeof r.value !== "boolean") {
        return { ok: false, reason: `! 的操作数必须是布尔值（实际 ${typeName(r.value)}）` };
      }
      return { ok: true, value: !r.value };
    }
    case "ident": {
      if (!Object.prototype.hasOwnProperty.call(facts, n.name)) {
        return { ok: false, reason: `未识别的标识符 ${n.name}` };
      }
      return { ok: true, value: facts[n.name] };
    }
    default: {
      const l = evalNode(n.l, facts);
      if (!l.ok) return l;
      const r = evalNode(n.r, facts);
      if (!r.ok) return r;
      return evalBin(n.op, l.value, r.value);
    }
  }
}

/** 收集 AST 中出现的全部标识符（去重）。用于契约校验阶段（此时还没有轨迹值）。 */
export function exprIdentifiers(ast: Node): string[] {
  const found = new Set<string>();
  const walk = (n: Node): void => {
    switch (n.k) {
      case "ident":
        found.add(n.name);
        return;
      case "arr":
        n.items.forEach(walk);
        return;
      case "not":
        walk(n.x);
        return;
      case "bin":
        walk(n.l);
        walk(n.r);
        return;
      default:
        return;
    }
  };
  walk(ast);
  return [...found];
}

// ---------------------------------------------------------------------------
// 静态类型推断（契约校验期用，此时还没有轨迹值）
// ---------------------------------------------------------------------------

function typeLabel(t: ExprType): string {
  switch (t) {
    case "number":
      return "数字";
    case "string":
      return "字符串";
    case "boolean":
      return "布尔值";
    default:
      return "字符串数组";
  }
}

/** 二元运算符的静态类型规则。**与 evalBin 的运行时规则必须逐条对应**。 */
function inferBinType(
  op: string,
  l: ExprType,
  r: ExprType,
): { ok: true; type: ExprType } | { ok: false; reason: string } {
  switch (op) {
    case "&&":
    case "||":
      if (l !== "boolean" || r !== "boolean") {
        return { ok: false, reason: `${op} 两边都必须是布尔值（实际 ${typeLabel(l)} 与 ${typeLabel(r)}）` };
      }
      return { ok: true, type: "boolean" };
    case "==":
    case "!=":
      if (l !== r) {
        return { ok: false, reason: `${op} 两边类型必须一致（实际 ${typeLabel(l)} 与 ${typeLabel(r)}）` };
      }
      return { ok: true, type: "boolean" };
    case ">":
    case "<":
    case ">=":
    case "<=":
      if (l !== "number" || r !== "number") {
        return { ok: false, reason: `${op} 两边都必须是数字（实际 ${typeLabel(l)} 与 ${typeLabel(r)}）` };
      }
      return { ok: true, type: "boolean" };
    case "⊆":
    case "⊇":
      if (l !== "string_array" || r !== "string_array") {
        return {
          ok: false,
          reason: `${op} 两边都必须是字符串数组（实际 ${typeLabel(l)} 与 ${typeLabel(r)}）`,
        };
      }
      return { ok: true, type: "boolean" };
    case "∈":
    case "∉":
      if (l !== "string" || r !== "string_array") {
        return {
          ok: false,
          reason: `${op} 左边必须是字符串、右边必须是字符串数组（实际 ${typeLabel(l)} 与 ${typeLabel(r)}）`,
        };
      }
      return { ok: true, type: "boolean" };
    default:
      return { ok: false, reason: `不支持的运算符 ${op}` };
  }
}

/**
 * 对 AST 做静态类型推断，标识符类型由 `types` 给出。
 *
 * 为什么需要它：只查语法与标识符名字**挡不住类型写错的断言**。
 * `doc_count ⊆ cited_doc_ids` 语法完全合法、两个标识符都在词汇表里，
 * 但求值时必然失败（数字不能做子集判断）。若不在契约校验期拦下，
 * 这条断言会一路走到评分才暴露——那时用户已经跑完录制与回放了。
 */
export function inferExprType(
  ast: Node,
  types: TypeTable,
): { ok: true; type: ExprType } | { ok: false; reason: string } {
  switch (ast.k) {
    case "num":
      return { ok: true, type: "number" };
    case "str":
      return { ok: true, type: "string" };
    case "arr": {
      for (const item of ast.items) {
        const t = inferExprType(item, types);
        if (!t.ok) return t;
        if (t.type !== "string") {
          return { ok: false, reason: `数组元素必须是字符串（实际 ${typeLabel(t.type)}）` };
        }
      }
      return { ok: true, type: "string_array" };
    }
    case "not": {
      const t = inferExprType(ast.x, types);
      if (!t.ok) return t;
      if (t.type !== "boolean") {
        return { ok: false, reason: `! 的操作数必须是布尔值（实际 ${typeLabel(t.type)}）` };
      }
      return { ok: true, type: "boolean" };
    }
    case "ident": {
      // hasOwnProperty.call 而非 in：constructor / __proto__ 不是合法事实名。
      if (!Object.prototype.hasOwnProperty.call(types, ast.name)) {
        return { ok: false, reason: `未识别的标识符 ${ast.name}（不在事实词汇表内）` };
      }
      return { ok: true, type: types[ast.name] };
    }
    default: {
      const l = inferExprType(ast.l, types);
      if (!l.ok) return l;
      const r = inferExprType(ast.r, types);
      if (!r.ok) return r;
      return inferBinType(ast.op, l.type, r.type);
    }
  }
}

/**
 * 对 AST 求值。**顶层结果必须是布尔值**——assert 断言的语义就是「真 / 假」，
 * 求出一个数字或字符串说明表达式写错了，应报错而不是做隐式真值转换。
 */
export function evaluateExpr(ast: Node, facts: Facts): EvalResult {
  const r = evalNode(ast, facts);
  if (!r.ok) return r;
  if (typeof r.value !== "boolean") {
    return { ok: false, reason: `表达式结果必须是布尔值（实际 ${typeName(r.value)}）` };
  }
  return r;
}

/** 解析 + 求值的便捷入口。 */
export function evalExpr(src: string, facts: Facts): EvalResult {
  const parsed = parseExpr(src);
  if (!parsed.ok) return parsed;
  return evaluateExpr(parsed.ast, facts);
}

/**
 * 「可求值性」检查：语法正确 + 标识符全部命中词汇表 + **静态类型自洽** + 顶层必为布尔。
 *
 * 契约校验阶段用（那时还没有轨迹，无法真正求值）。这是 PRD §6.3
 * 「契约中 100% 任务都有可执行 checks」的真检查——原先只判断 `expr` 是否非空字符串，
 * 于是中文句子 `cited_doc_ids 全部来自检索结果` 也能通过校验。
 *
 * `types` 的键集合即白名单，避免「白名单」与「类型表」两份数据漂移。
 */
export function checkExpr(
  src: string,
  types: TypeTable,
): { ok: true } | { ok: false; reason: string } {
  const parsed = parseExpr(src);
  if (!parsed.ok) return parsed;
  const inferred = inferExprType(parsed.ast, types);
  if (!inferred.ok) return inferred;
  if (inferred.type !== "boolean") {
    return {
      ok: false,
      reason: `断言表达式的顶层结果必须是布尔值（实际 ${typeLabel(inferred.type)}）`,
    };
  }
  return { ok: true };
}
