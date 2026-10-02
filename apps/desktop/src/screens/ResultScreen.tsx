import { computeStats, type ScoreResult } from "@cegueira/scorer";
import {
  levelOf,
  stateOf,
  uncertainty,
  type ProfileState,
} from "@cegueira/profile";
import type { LadderState } from "@cegueira/ladder";

const STATE_LABEL: Record<ProfileState, { text: string; className: string }> = {
  assessing: { text: "评估中", className: "assessing" },
  near_boundary: { text: "上升中", className: "near_boundary" },
  confident: { text: "已确定", className: "confident" },
};

const DIM_LABEL: Record<string, { name: string; weight: number }> = {
  outcome: { name: "任务成功率", weight: 0.5 },
  process: { name: "过程质量", weight: 0.25 },
  semantic: { name: "语义质量", weight: 0.15 },
  rubric: { name: "主观质量", weight: 0.1 },
};

interface Props {
  score: ScoreResult;
  ladder: LadderState;
  onRestart: () => void;
}

export default function ResultScreen({ score, ladder, onRestart }: Props) {
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
      <h1>评分结果</h1>
      <p className="lead">确定性回放评分已完成。分数为区间估计而非单点值。</p>

      <div className="score-hero">
        <div>
          <div className="muted">最终得分</div>
          <div className={`score-num ${tone}`}>{score.finalScore}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div className="muted">统计（多次采样）</div>
          <div className="row" style={{ gap: 18, marginTop: 6 }}>
            <span>均值 <b>{stats.mean.toFixed(1)}</b></span>
            <span>标准差 <b>{stats.std.toFixed(1)}</b></span>
            <span>最差 <b>{stats.worst.toFixed(1)}</b></span>
            <span>95% CI <b>[{stats.ci[0].toFixed(1)}, {stats.ci[1].toFixed(1)}]</b></span>
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            S_core = {score.sCore.toFixed(4)}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>四维得分</h2>
        <div className="dims">
          {Object.entries(score.dimensions).map(([k, v]) => (
            <div className="dim" key={k}>
              <div className="dim-name">
                {DIM_LABEL[k].name} · 权重 {DIM_LABEL[k].weight}
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
        <h2>门控</h2>
        <div className="gate-row">
          <span>安全三断言</span>
          {score.gates.security.passed ? (
            <span className="gate-pass">通过</span>
          ) : (
            <span className="gate-fail">未通过（一票否决）：{score.gates.security.violations.join("、")}</span>
          )}
        </div>
        <div className="gate-row">
          <span>结果门控（outcome min ≥ 0.30）</span>
          {score.gates.outcome.passed ? (
            <span className="gate-pass">通过（min = {score.gates.outcome.min.toFixed(3)}）</span>
          ) : (
            <span className="gate-fail">未通过（min = {score.gates.outcome.min.toFixed(3)}）</span>
          )}
        </div>
      </div>

      <div className="card">
        <h2>技能画像</h2>
        <div className="row" style={{ alignItems: "center" }}>
          <span className="level-badge">
            L{level.level} · {level.name}
          </span>
          <span className={`state-chip ${STATE_LABEL[state].className}`}>
            {STATE_LABEL[state].text}
          </span>
          {lucidez && (
            <span className="state-chip confident" style={{ borderColor: "var(--iris)", color: "var(--iris)" }}>
              已达成 Lucidez · 复明
            </span>
          )}
        </div>
        <p className="muted" style={{ marginBottom: 4 }}>
          技能分 {skillScore.toFixed(2)} / 10 · 不确定度 {u.toFixed(2)}
        </p>
        <p className="muted" style={{ marginTop: 0 }}>
          档位区间：{level.min}–{level.max}
          {state === "near_boundary" ? "（接近档位边界，正向上升中）" : ""}
        </p>
        <p className="hint">
          辅助阶梯使用：L3 请求 {ladder.l3Requests} 次 · L4 请求 {ladder.l4Requests} 次
          {ladder.l3Requests + ladder.l4Requests > 3 ? "（频繁请求高等级辅助，掌握度可能被高估）" : ""}
        </p>
      </div>

      <div className="row">
        <button className="btn ghost" onClick={onRestart}>
          ← 开始新项目
        </button>
      </div>
    </div>
  );
}
