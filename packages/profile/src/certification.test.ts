import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateCertification,
  HARD_DIFFICULTY,
  LEVEL5_MIN_PROJECTS,
  LEVEL6_MIN_PROJECTS,
  type ProjectEvidence,
} from "./certification.js";

const p = (
  difficulty: number,
  reproducible = true,
  adopted = false,
): ProjectEvidence => ({
  projectId: `p${difficulty}-${reproducible}-${adopted}`,
  difficulty,
  reproducible,
  adopted,
});

test("档位不足：未达精通档 → 即使有证据也不认证", () => {
  const r = evaluateCertification(4, [p(9), p(8)]);
  assert.equal(r.level5, false);
  assert.equal(r.level6, false);
});

test("精通认证：需 ≥2 个「难度≥8 且可复现」项目", () => {
  const need = LEVEL5_MIN_PROJECTS;
  // 恰好达标
  const ok = evaluateCertification(5, [p(8.0), p(9.5)]);
  assert.equal(ok.hardReproducibleProjects, 2);
  assert.equal(ok.level5, true);
  assert.ok(need === 2);
  // 少一个
  assert.equal(evaluateCertification(5, [p(8.0)]).level5, false);
});

test("难度 <8 或不可复现的项目不计入精通认证", () => {
  const r = evaluateCertification(5, [
    { projectId: "a", difficulty: HARD_DIFFICULTY - 0.1, reproducible: true, adopted: false },
    { projectId: "b", difficulty: 9, reproducible: false, adopted: false },
  ]);
  assert.equal(r.hardReproducibleProjects, 0);
  assert.equal(r.level5, false);
});

test("大师认证：需 ≥1 个被采用的项目", () => {
  const ok = evaluateCertification(6, [
    p(8, false, true), // 被采用（可复现与否不影响大师）
  ]);
  assert.equal(ok.adoptedProjects, 1);
  assert.equal(ok.level6, true);
  assert.ok(LEVEL6_MIN_PROJECTS === 1);
  // 档位不足或未被采用 → 不通过
  assert.equal(evaluateCertification(6, [p(9)]).level6, false);
  assert.equal(evaluateCertification(5, [p(9, false, true)]).level6, false);
});

test("空证据：计数为 0，两档均不通过", () => {
  const r = evaluateCertification(6, []);
  assert.deepEqual(r, {
    level5: false,
    level6: false,
    hardReproducibleProjects: 0,
    adoptedProjects: 0,
  });
});
