import { useState } from "react";
import type { ContractBundle } from "@cegueira/contract";
import { score, type ScoreInput, type ScoreResult } from "@cegueira/scorer";
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

const LEVEL_HINTS_TITLE: Record<LadderLevel, string> = {
  0: "报错提示",
  1: "范围提示",
  2: "提问引导",
  3: "方案思路",
  4: "参考代码",
};

interface Props {
  bundle: ContractBundle;
  ladder: LadderState;
  setLadder: (s: LadderState) => void;
  onDone: (s: ScoreResult) => void;
}

export default function DevelopScreen({ bundle, ladder, setLadder, onDone }: Props) {
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
      <h1>开发中 · {bundle.projectMd.title}</h1>
      <p className="lead">按契约拆解任务，卡住时使用辅助阶梯（默认 L2 提问引导）。</p>

      <div className="card">
        <h2>契约概览</h2>
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
        <h2>辅助阶梯</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          系统只在你想放弃时给「恰好够用」的帮助，而不是替你写。
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
          <div className="assist-tag">L{ladder.level} · {LEVEL_HINTS_TITLE[ladder.level]}</div>
          <div className="mono" style={{ whiteSpace: "pre-wrap" }}>{LEVEL_HINTS[ladder.level]}</div>
        </div>

        {ladder.level < 4 && (
          <div className="row">
            <button className="btn ghost" onClick={handleStuck}>
              还是卡住，需要更多提示
            </button>
            <button className="btn ghost" onClick={handleL3}>
              需要方案思路（L3）
            </button>
            <button className="btn ghost" onClick={handleL4}>
              需要可运行代码（L4）
            </button>
          </div>
        )}

        {ladder.level === 4 && (
          <div className="card" style={{ background: "var(--bg-soft)" }}>
            <h2>L4 追问（必答）</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              请用自己的话说明：上面的代码为什么能解决问题？
            </p>
            <textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              rows={2}
              placeholder="例如：它通过过滤低相关文档，避免把噪声内容写进答案……"
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
                {ladder.l4Explained ? "已确认理解 ✓" : "提交解释"}
              </button>
            </div>
          </div>
        )}

        {isOverReliant(ladder) && (
          <p className="hint" style={{ color: "var(--warn)" }}>
            提示：频繁请求 L3/L4 会被记录为「掌握度可能被高估」的信号。
          </p>
        )}
      </div>

      <div className="row">
        <button className="btn primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "评分中…" : "提交评分 →"}
        </button>
        <span className="muted">提交后进入确定性回放评分。</span>
      </div>
    </div>
  );
}
