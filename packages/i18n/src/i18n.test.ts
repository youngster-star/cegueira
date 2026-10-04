import assert from "node:assert/strict";
import { test } from "node:test";

import { createI18n, diffKeys, interpolate } from "./i18n.js";
import { enDict, zhDict } from "./types.js";

test("t：命中返回词典译文", () => {
  const zh = createI18n("zh");
  assert.equal(zh.t("step.direction"), "方向");
  const en = createI18n("en");
  assert.equal(en.t("step.direction"), "Direction");
});

test("t：缺词回退返回 key（不静默）", () => {
  const zh = createI18n("zh");
  assert.equal(zh.t("nonexistent.key"), "nonexistent.key");
});

test("t：插值替换 {var}", () => {
  const zh = createI18n("zh");
  assert.equal(
    zh.t("result.gatePassMin", { min: "0.300" }),
    "通过（min = 0.300）",
  );
});

test("interpolate：多处同参数替换", () => {
  assert.equal(interpolate("{a}-{a}-{b}", { a: "x", b: 1 }), "x-x-1");
});

test("diffKeys：中英词条 key 一致", () => {
  const d = diffKeys(zhDict, enDict);
  assert.deepEqual(d.onlyInA, []);
  assert.deepEqual(d.onlyInB, []);
});

test("locale：语言切换", () => {
  const zh = createI18n("zh");
  const en = createI18n("en");
  assert.equal(zh.locale, "zh");
  assert.equal(en.locale, "en");
  assert.notEqual(zh.t("brand.subtitle"), en.t("brand.subtitle"));
});
