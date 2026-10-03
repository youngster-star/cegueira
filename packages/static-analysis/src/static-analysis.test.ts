import { test } from "node:test";
import assert from "node:assert";
import { scan } from "./index.js";

test("scan：干净代码无弱点", () => {
  const r = scan("def add(a, b):\n    return a + b\n");
  assert.equal(r.counts.total, 0);
  assert.equal(r.weaknessScore, 0);
});

test("scan：检出硬编码密钥（high，行号正确）", () => {
  const r = scan("# comment\ndef f():\n    key = 'sk-abcdefghijklmnop123456'\n");
  const f = r.findings.find((x) => x.category === "hardcoded_api_key");
  assert.ok(f);
  assert.equal(f.severity, "high");
  assert.equal(f.line, 3);
});

test("scan：检出危险 eval/exec/pickle", () => {
  const r = scan("eval(code)\nexec(cmd)\nobj = pickle.loads(data)\n");
  const cats = r.findings.map((f) => f.category);
  assert.ok(cats.includes("dangerous_eval"));
  assert.ok(cats.includes("dangerous_exec"));
  assert.ok(cats.includes("unsafe_pickle"));
  assert.equal(r.counts.high, 3);
});

test("scan：检出 medium 级弱点（yaml.load / rm -rf / SQL 拼接）", () => {
  const r = scan("yaml.load(f)\nrm -rf /tmp/x\nq = \"SELECT * FROM t WHERE id=\" + uid\n");
  const cats = r.findings.map((f) => f.category);
  assert.ok(cats.includes("unsafe_yaml"));
  assert.ok(cats.includes("destructive_rm"));
  assert.ok(cats.includes("sql_injection"));
  assert.equal(r.counts.medium, 3);
});

test("scan：检出 low 级明文密码", () => {
  const r = scan("password = \"admin1234\"\n");
  const f = r.findings.find((x) => x.category === "password_plaintext");
  assert.ok(f);
  assert.equal(f.severity, "low");
});

test("scan：加权弱点分数正确（1 high + 1 medium + 1 low = 1.7）", () => {
  const r = scan("eval(x)\nyaml.load(f)\npassword = \"admin1234\"\n");
  assert.equal(r.counts.high, 1);
  assert.equal(r.counts.medium, 1);
  assert.equal(r.counts.low, 1);
  assert.equal(r.weaknessScore, 1.7);
});

test("scan：同一行多个弱点均检出", () => {
  const r = scan("eval(x); exec(y)\n");
  assert.equal(r.findings.length, 2);
});

test("scan：区分大小写规则（pickle/yaml 小写才命中）", () => {
  const r = scan("Pickle.Loads(data)\nYAML.load(f)\n");
  assert.equal(r.findings.length, 0);
});
