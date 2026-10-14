import { useState } from "react";
import type { ContractBundle } from "@cegueira/contract";
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
import { backend, type GradeData } from "../lib/backend";

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
  contractPath: string;
  evalsetPath: string;
  onDone: (g: GradeData) => void;
}

export default function DevelopScreen({
  t,
  bundle,
  ladder,
  setLadder,
  contractPath,
  evalsetPath,
  onDone,
}: Props) {
  const [explanation, setExplanation] = useState("");
  const [agentDir, setAgentDir] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStuck = () => setLadder(onStuck(ladder));
  const handleL3 = () => setLadder(requestUpgrade(ladder, 3));
  const handleL4 = () => setLadder(requestUpgrade(ladder, 4));
  const handleExplain = () => {
    if (explanation.trim()) setLadder(explainL4(ladder));
  };

  // PRD §6.4 硬约束 1：请求过 L4 却未用自己的话解释，不得提交（技能分不升级）。
  const l4Pending = ladder.l4Requests > 0 && !ladder.l4Explained;
  const canRun = !l4Pending && agentDir.trim().length > 0 && !running;

  // 真实运行：录制用户 Agent（Python）→ 确定性评分。取代此前的硬编码演示分。
  const handleRun = async () => {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    try {
      const rec = await backend.record({ agentDir: agentDir.trim(), evalsetPath });
      const g = await backend.grade({
        contractPath,
        runDir: rec.runDir,
        evalsetPath,
        sourcePath: agentDir.trim(),
        ladder,
      });
      onDone(g);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
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

      <div className="card">
        <h2>{t("develop.agentDir")}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("develop.agentDirHint")}
        </p>
        <input
          className="input"
          value={agentDir}
          placeholder="E:\\code\\my-agent  或  fixtures/demo-agent"
          onChange={(e) => setAgentDir(e.target.value)}
          autoComplete="off"
        />
      </div>

      {error && (
        <p className="hint" style={{ color: "var(--warn)", whiteSpace: "pre-wrap" }}>
          {t("common.error")}
          {error}
        </p>
      )}

      <div className="row">
        <button className="btn primary" onClick={handleRun} disabled={!canRun}>
          {running ? t("develop.running") : t("develop.run")} →
        </button>
        <span className="muted">
          {l4Pending ? t("develop.l4Prompt") : t("develop.submitHint")}
        </span>
      </div>
    </div>
  );
}
