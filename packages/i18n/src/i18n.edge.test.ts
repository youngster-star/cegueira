import assert from "node:assert/strict";
import { test } from "node:test";

import { createI18n, diffKeys, interpolate } from "./i18n.js";
import { enDict, zhDict } from "./types.js";

test("interpolate：特殊字符（$、反斜杠）不误处理", () => {
  assert.equal(interpolate("价格 {p}", { p: "$100" }), "价格 $100");
  assert.equal(interpolate("路径 {p}", { p: "C:\\dir\\f" }), "路径 C:\\dir\\f");
});

test("interpolate：未提供参数时占位符保留", () => {
  assert.equal(interpolate("升级到 {level}", {}), "升级到 {level}");
});

test("interpolate：空参数对象原样返回", () => {
  assert.equal(interpolate("无占位符文本", {}), "无占位符文本");
});

test("interpolate：数字参数转字符串", () => {
  assert.equal(interpolate("第 {n} 档", { n: 3 }), "第 3 档");
});

test("t：插值参数含特殊字符", () => {
  const zh = createI18n("zh");
  assert.equal(zh.t("develop.upgrade", { level: "L4" }), "升级到 L4");
});

test("t：无参数调用缺词返回 key", () => {
  const zh = createI18n("zh");
  assert.equal(zh.t("missing"), "missing");
});

test("diffKeys：单向缺失正确报告", () => {
  const d = diffKeys({ a: "1", b: "2" }, { a: "1" });
  assert.deepEqual(d.onlyInA, ["b"]);
  assert.deepEqual(d.onlyInB, []);
});

test("diffKeys：双向缺失", () => {
  const d = diffKeys({ a: "1" }, { b: "2" });
  assert.deepEqual(d.onlyInA, ["a"]);
  assert.deepEqual(d.onlyInB, ["b"]);
});

test("createI18n：未知 locale 回退英文词典（不崩溃）", () => {
  const i18n = createI18n("fr" as "zh");
  assert.equal(i18n.t("brand.subtitle"), enDict["brand.subtitle"]);
});

test("中英词典 key 集合一致（无漏译）", () => {
  const d = diffKeys(zhDict, enDict);
  assert.equal(d.onlyInA.length, 0);
  assert.equal(d.onlyInB.length, 0);
});
