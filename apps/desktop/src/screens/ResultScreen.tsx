import { computeStats, type ScoreResult } from "@cegueira/scorer";
import {
  levelOf,
  stateOf,
  uncertainty,
  type ProfileState,
} from "@cegueira/profile";
import type { LadderState } from "@cegueira/ladder";
import type { TFunc } from "@cegueira/i18n";

const STATE_CLASS: Record<ProfileState, string> = {
  assessing: "assessing",
  near_boundary: "near_boundary",
  confident: "confident",
};

const DIM_WEIGHT: Record<string, number> = {
  outcome: 0.5,
  process: 0.25,
  semantic: 0.15,
  rubric: 0.1,
};

interface Props {
  t: TFunc;
  score: ScoreResult;
  ladder: LadderState;
  onRestart: () => void;
}

export default function ResultScreen({ t, score, ladder, onRestart }: Props) {
  // 演示采样（P2 接入真实多次采样后替换）
  const stats = computeStats([85.3, 86.1, 84.7]);

  // 画像：评分 0–100 映射到 0–10
  const skillScore = score.finalScore / 10;
  const level = levelOf(skillScore);
  const u = uncertainty(3, new Date(), new Date());
  const state = stateOf(skillScore, u);
  const lucidez = skillScore >= 8.0;

  const tone = score.finalScore >= 80 ? "good" : score.finalScore >= 60 ? "mid" : "bad";

  return (
    <div className="screen">
      <h1>{t("result.title")}</h1>
      <p className="lead">{t("result.lead")}</p>

      <div className="score-hero">
        <div>
          <div className="muted">{t("result.score")}</div>
          <div className={`score-num ${tone}`}>{score.finalScore}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div className="muted">{t("result.stats")}</div>
          <div className="row" style={{ gap: 18, marginTop: 6 }}>
            <span>{t("result.mean")} <b>{stats.mean.toFixed(1)}</b></span>
            <span>{t("result.std")} <b>{stats.std.toFixed(1)}</b></span>
            <span>{t("result.worst")} <b>{stats.worst.toFixed(1)}</b></span>
            <span>{t("result.ci")} <b>[{stats.ci[0].toFixed(1)}, {stats.ci[1].toFixed(1)}]</b></span>
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            S_core = {score.sCore.toFixed(4)}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>{t("result.dimensions")}</h2>
        <div className="dims">
          {Object.entries(score.dimensions).map(([k, v]) => (
            <div className="dim" key={k}>
              <div className="dim-name">
                {t(`result.dim.${k}`)} · {t("result.weight")} {DIM_WEIGHT[k]}
              </div>
              <div className="dim-val">{(v * 100).toFixed(1)}</div>
              <div className="bar">
                <i style={{ width: `${(v * 100).toFixed(1)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>{t("result.gates")}</h2>
        <div className="gate-row">
          <span>{t("result.gateSecurity")}</span>
          {score.gates.security.passed ? (
            <span className="gate-pass">{t("result.gatePass")}</span>
          ) : (
            <span className="gate-fail">{t("result.gateFail")}：{score.gates.security.violations.join("、")}</span>
          )}
        </div>
        <div className="gate-row">
          <span>{t("result.gateOutcome")}</span>
          {score.gates.outcome.passed ? (
            <span className="gate-pass">{t("result.gatePassMin", { min: score.gates.outcome.min.toFixed(3) })}</span>
          ) : (
            <span className="gate-fail">{t("result.gateFailMin", { min: score.gates.outcome.min.toFixed(3) })}</span>
          )}
        </div>
      </div>

      <div className="card">
        <h2>{t("result.profile")}</h2>
        <div className="row" style={{ alignItems: "center" }}>
          <span className="level-badge">
            L{level.level} · {level.name}
          </span>
          <span className={`state-chip ${STATE_CLASS[state]}`}>
            {t(`result.state.${state}`)}
          </span>
          {lucidez && (
            <span className="state-chip confident" style={{ borderColor: "var(--iris)", color: "var(--iris)" }}>
              {t("result.lucidez")}
            </span>
          )}
        </div>
        <p className="muted" style={{ marginBottom: 4 }}>
          {t("result.skillScore", { score: skillScore.toFixed(2), u: u.toFixed(2) })}
        </p>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("result.levelRange", { min: level.min, max: level.max })}
          {state === "near_boundary" ? t("result.nearBoundary") : ""}
        </p>
        <p className="hint">
          {t("result.ladderUsage", { l3: ladder.l3Requests, l4: ladder.l4Requests })}
          {ladder.l3Requests + ladder.l4Requests > 3 ? t("result.overReliant") : ""}
        </p>
      </div>

      <div className="row">
        <button className="btn ghost" onClick={onRestart}>
          {t("result.restart")}
        </button>
      </div>
    </div>
  );
}
