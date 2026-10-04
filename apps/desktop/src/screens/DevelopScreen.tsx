import { useState } from "react";
import type { ContractBundle } from "@cegueira/contract";
import { score, type ScoreInput, type ScoreResult } from "@cegueira/scorer";
import type { TFunc } from "@cegueira/i18n";
import {
  LEVEL_DESC,
  explainL4,
  isOverReliant,
  onStuck,
  requestUpgrade,
  type LadderLevel,
  type LadderState,
} from "@cegueira/ladder";

const LEVEL_HINTS: Record<LadderLevel, string> = {
  0: "你的 Agent 当前有报错输出。先从报错信息入手，定位是哪一步失败。",
  1: "问题出在检索阶段——检查你传给检索工具的 query 参数是否与用户问题一致。",
  2: "你注意到检索返回的文档里，有没有和你问题无关的内容？为什么回答会引用它？",
  3: "思路提示：在生成回答前，先按相似度阈值过滤检索结果，只保留最相关的文档再做引用。",
  4: "可运行示例：\nfor doc in docs:\n    if doc.score < 0.5:\n        continue  # 过滤低相关文档\n    answer += f\"[{doc.id}] {doc.text}\\n\"",
};

interface Props {
  t: TFunc;
  bundle: ContractBundle;
  ladder: LadderState;
  setLadder: (s: LadderState) => void;
  onDone: (s: ScoreResult) => void;
}

export default function DevelopScreen({ t, bundle, ladder, setLadder, onDone }: Props) {
  const [explanation, setExplanation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleStuck = () => setLadder(onStuck(ladder));
  const handleL3 = () => setLadder(requestUpgrade(ladder, 3));
  const handleL4 = () => setLadder(requestUpgrade(ladder, 4));
  const handleExplain = () => {
    if (explanation.trim()) setLadder(explainL4(ladder));
  };

  const handleSubmit = () => {
    setSubmitting(true);
    // 最小 GUI 阶段：用演示采样模拟一次提交；P2 接入录制回放后替换为真实轨迹。
    const input: ScoreInput = {
      outcomeSamples: [0.9, 0.88, 0.92],
      process: 0.8,
      semantic: 0.85,
      rubricSamples: [0.7, 0.75, 0.8],
      security: {
        no_unauthorized_mutation: true,
        tool_call_whitelist: true,
        no_prompt_leak: true,
      },
    };
    setTimeout(() => {
      onDone(score(input));
    }, 400);
  };

  return (
    <div className="screen">
      <h1>
        {t("develop.title")} · {bundle.projectMd.title}
      </h1>
      <p className="lead">{t("develop.lead")}</p>

      <div className="card">
        <h2>{t("develop.contractOverview")}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {bundle.projectMd.coreFunction} · {bundle.projectMd.coreTech}
        </p>
        <div className="stage-list">
          {bundle.contract.stages.map((s) => (
            <div key={s.id} className="stage-item">
              <div className="stage-name">{s.name}</div>
              {s.tasks.map((t) => (
                <span key={t.id} className="task-chip">
                  {t.name}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>{t("develop.ladder")}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("develop.ladderHint")}
        </p>
        <div className="ladder-levels">
          {([0, 1, 2, 3, 4] as LadderLevel[]).map((lv) => (
            <div key={lv} className={`ladder-level ${ladder.level === lv ? "on" : ""}`}>
              <div className="lv-name">L{lv}</div>
              <div className="lv-desc">{LEVEL_DESC[lv]}</div>
            </div>
          ))}
        </div>

        <div className="assist-box">
          <div className="assist-tag">L{ladder.level} · {t(`develop.hint${ladder.level}`)}</div>
          <div className="mono" style={{ whiteSpace: "pre-wrap" }}>{LEVEL_HINTS[ladder.level]}</div>
        </div>

        {ladder.level < 4 && (
          <div className="row">
            <button className="btn ghost" onClick={handleStuck}>
              {t("develop.stuck")}
            </button>
            <button className="btn ghost" onClick={handleL3}>
              {t("develop.needL3")}
            </button>
            <button className="btn ghost" onClick={handleL4}>
              {t("develop.needL4")}
            </button>
          </div>
        )}

        {ladder.level === 4 && (
          <div className="card" style={{ background: "var(--bg-soft)" }}>
            <h2>{t("develop.l4Title")}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {t("develop.l4Prompt")}
            </p>
            <textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              rows={2}
              placeholder={t("develop.l4Placeholder")}
              style={{
                width: "100%",
                background: "var(--bg)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 10,
                resize: "vertical",
              }}
            />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={handleExplain} disabled={!explanation.trim()}>
                {ladder.l4Explained ? t("develop.confirmed") : t("develop.submitExplanation")}
              </button>
            </div>
          </div>
        )}

        {isOverReliant(ladder) && (
          <p className="hint" style={{ color: "var(--warn)" }}>
            {t("develop.overReliant")}
          </p>
        )}
      </div>

      <div className="row">
        <button className="btn primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? t("develop.scoring") : t("develop.submit")}
        </button>
        <span className="muted">{t("develop.submitHint")}</span>
      </div>
    </div>
  );
}
