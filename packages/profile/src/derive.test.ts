import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateSkill, isLucidez } from "./derive.js";

test("aggregateSkill：均值→0–10 分→档位，样本少则不确定度高", () => {
  const { skill, profile } = aggregateSkill({
    skill: "RAG",
    finalScores: [80, 80, 80],
    lastAssessedAt: "2026-01-01T00:00:00.000Z",
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(skill, "RAG");
  assert.equal(profile.score, 8);
  assert.equal(profile.level, 5); // [8.0,9.0) 精通
  assert.equal(profile.uncertainty, 0.25); // 1/(1+3)
  assert.equal(profile.state, "near_boundary"); // 8.0 贴近档位下界
});

test("aggregateSkill：单样本且刚到边界外 → confident", () => {
  const { profile } = aggregateSkill({
    skill: "RAG",
    finalScores: [30],
    lastAssessedAt: "2026-01-01T00:00:00.000Z",
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(profile.score, 3);
  assert.equal(profile.level, 2);
  assert.equal(profile.state, "confident"); // u=0.5 未超阈值，且远离边界
});

test("aggregateSkill：满分为 10.0 归入第 6 档", () => {
  const { profile } = aggregateSkill({
    skill: "RAG",
    finalScores: [100],
    lastAssessedAt: "2026-01-01T00:00:00.000Z",
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(profile.level, 6);
  assert.equal(profile.score, 10);
});

test("aggregateSkill：空列表与越界分数抛错", () => {
  assert.throws(
    () => aggregateSkill({ skill: "x", finalScores: [], lastAssessedAt: "2026-01-01T00:00:00.000Z" }),
    /不能为空/,
  );
  assert.throws(
    () => aggregateSkill({ skill: "x", finalScores: [120], lastAssessedAt: "2026-01-01T00:00:00.000Z" }),
    /越界/,
  );
});

test("isLucidez：第 5 档（掌握）起算（开发文档 §9.5）", () => {
  assert.equal(isLucidez(4), false);
  assert.equal(isLucidez(5), true);
  assert.equal(isLucidez(6), true);
});
