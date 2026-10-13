import { test } from "node:test";
import assert from "node:assert";
import {
  buildPreview,
  processPrivacy,
  pruneAst,
  redact,
  routeSupplier,
  stripComments,
  stripLiterals,
} from "./index.js";

test("redact：邮箱/手机/密钥/内网 IP 全部脱敏", () => {
  const r = redact(
    "联系 a@b.com 电话 13800138000，key sk-abcdefghijklmnop123456，来自 192.168.1.10",
  );
  assert.ok(r.text.includes("[EMAIL]"));
  assert.ok(r.text.includes("[PHONE]"));
  assert.ok(r.text.includes("[KEY]"));
  assert.ok(r.text.includes("[IP]"));
  assert.equal(r.hits.length, 4);
});

test("redact：无敏感信息时不误伤", () => {
  const r = redact("这是普通文本，没有敏感信息。");
  assert.equal(r.hitCount, 0);
  assert.equal(r.text, "这是普通文本，没有敏感信息。");
});

test("redact：secret 键值对与 bearer token", () => {
  const r = redact("api_key=abcdefgh12345678\nAuthorization: bearer eyJhbGciOiJIUzI1NiJ9");
  assert.ok(r.text.includes("api_key=[REDACTED]"));
  assert.ok(r.text.toLowerCase().includes("[token]"));
});

test("stripComments：去 #、//、块注释", () => {
  const src = "# py comment\nconst a = 1; // inline\n/* block\ncomment */\nconst b = 2;";
  const out = stripComments(src);
  assert.ok(!out.includes("py comment"));
  assert.ok(!out.includes("inline"));
  assert.ok(!out.includes("block"));
  assert.ok(out.includes("const a = 1;"));
});

test("stripLiterals：字符串与数字替换为占位", () => {
  const out = stripLiterals('const s = "hello world"; const n = 42;');
  assert.ok(out.includes('"…"'));
  assert.ok(!out.includes("hello world"));
  assert.ok(!out.includes("42"));
});

test("pruneAst：保留签名，折叠函数体", () => {
  const src = [
    "def fetch(query):",
    '    url = "https://x"',
    "    return query",
    "",
    "class Foo:",
    "    def bar(self):",
    "        return 1",
  ].join("\n");
  const out = pruneAst(src);
  assert.ok(out.includes("def fetch"));
  assert.ok(!out.includes('"https://x"')); // 字面量已去
  assert.ok(out.includes("body pruned")); // 函数体已折叠
  assert.ok(out.includes("class Foo"));
});

test("redact：10.x 私网地址完整脱敏（回归：曾只匹配三段）", () => {
  const r = redact("内网 10.0.0.1 与 172.16.0.9");
  assert.equal(r.text, "内网 [IP] 与 [IP]");
});

test("pruneAst：字符串含 // 或 # 时不被注释规则截断（回归：曾先删注释）", () => {
  const out = pruneAst('url = "http://a/b#c"\ny = 2');
  assert.ok(out.includes('"…"'));
  assert.ok(!out.includes('"http:'));
  assert.ok(out.includes("y = N")); // 后续代码未被误当注释吞掉
});

test("routeSupplier：评审/生成路由到不同供应商", () => {
  assert.notEqual(routeSupplier("review"), routeSupplier("generation"));
});

test("buildPreview：含供应商、字符数与 token 估算", () => {
  const p = buildPreview("hello world", "review");
  assert.equal(p.supplier, routeSupplier("review"));
  assert.equal(p.charCount, 11);
  assert.equal(p.tokenEstimate, 3);
  assert.ok(p.summary.includes(p.supplier));
});

test("processPrivacy：完整流水线（脱敏→裁剪→预览）", () => {
  const r = processPrivacy(
    "联系 a@b.com\ndef run():\n    key = 'sk-abcdefghijklmnop123456'\n    return key",
    "generation",
  );
  assert.ok(r.redacted.hits.includes("email"));
  assert.ok(!r.pruned.includes("a@b.com"));
  assert.ok(!r.pruned.includes("sk-"));
  assert.equal(r.preview.supplier, routeSupplier("generation"));
});
