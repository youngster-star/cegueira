import { test } from "node:test";
import assert from "node:assert";
import {
  detectProxy,
  doctorCommand,
  maskProxy,
} from "./commands/doctor.js";

test("detectProxy：无代理环境变量", () => {
  const r = detectProxy({});
  assert.equal(r.detected, false);
  assert.equal(r.http, null);
});

test("detectProxy：大写环境变量", () => {
  const r = detectProxy({ HTTP_PROXY: "http://127.0.0.1:7890" });
  assert.equal(r.detected, true);
  assert.equal(r.http, "http://127.0.0.1:7890");
});

test("detectProxy：小写环境变量", () => {
  const r = detectProxy({ https_proxy: "http://127.0.0.1:7890" });
  assert.equal(r.detected, true);
  assert.equal(r.https, "http://127.0.0.1:7890");
});

test("detectProxy：ALL_PROXY 也算配置", () => {
  const r = detectProxy({ ALL_PROXY: "socks5://127.0.0.1:1080" });
  assert.equal(r.detected, true);
  assert.equal(r.all, "socks5://127.0.0.1:1080");
});

test("maskProxy：脱敏 user:pass@ 部分", () => {
  assert.equal(maskProxy("http://user:pass@host:8080"), "***@host:8080");
});

test("maskProxy：无认证信息则原样返回", () => {
  assert.equal(maskProxy("http://127.0.0.1:7890"), "http://127.0.0.1:7890");
});

test("doctorCommand：含代理时输出脱敏后的代理", () => {
  const out = doctorCommand("/tmp", { HTTP_PROXY: "http://user:pass@127.0.0.1:7890" });
  const line = out.split("\n").find((l) => l.startsWith("["));
  assert.ok(out.includes("proxy"));
  assert.ok(!out.includes("user:pass"), "不应泄露代理认证信息");
});

test("doctorCommand：无代理时输出提示性说明", () => {
  const out = doctorCommand("/tmp", {});
  assert.ok(out.includes("proxy"));
  assert.ok(out.includes("未配置"));
});

test("doctorCommand：始终包含 node 检查", () => {
  const out = doctorCommand("/tmp", {});
  assert.ok(out.includes("node"));
});
