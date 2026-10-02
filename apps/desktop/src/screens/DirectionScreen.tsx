import { useState } from "react";
import { generateBundle, type ContractBundle } from "@cegueira/contract";
import { LEVELS } from "@cegueira/profile";

const DIRECTIONS = [
  {
    id: "rag",
    label: "RAG 问答 Agent",
    desc: "基于语料库检索 + 生成回答，并引用出处",
    value: "RAG 问答",
  },
  {
    id: "tool",
    label: "工具调用 Agent",
    desc: "调用外部工具 / API 完成任务",
    value: "工具调用",
  },
  {
    id: "data",
    label: "数据分析 Agent",
    desc: "读取数据、分析并生成结论",
    value: "数据分析",
  },
];

interface Props {
  onGenerated: (bundle: ContractBundle) => void;
}

export default function DirectionScreen({ onGenerated }: Props) {
  const [direction, setDirection] = useState(DIRECTIONS[0].value);
  const [selfAssessment, setSelfAssessment] = useState(3);

  const handleGenerate = () => {
    onGenerated(generateBundle({ direction, selfAssessment: String(selfAssessment) }));
  };

  return (
    <div className="screen">
      <h1>选择练习方向</h1>
      <p className="lead">确定你想练习的 Agent 方向，Cegueira 会据此生成开发契约与测试集。</p>

      <div className="card">
        <h2>① 方向</h2>
        <div className="grid">
          {DIRECTIONS.map((d) => (
            <div
              key={d.id}
              className={`dir-card ${direction === d.value ? "selected" : ""}`}
              onClick={() => setDirection(d.value)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setDirection(d.value)}
            >
              <div className="dir-title">{d.label}</div>
              <div className="dir-desc">{d.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>② 技能自评</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          对照下表诚实评估当前水平，用于校准画像初始值（不影响本次契约）。
        </p>
        <div className="seg">
          {LEVELS.map((l) => (
            <button
              key={l.level}
              className={selfAssessment === l.level ? "on" : ""}
              onClick={() => setSelfAssessment(l.level)}
            >
              L{l.level} · {l.name}
            </button>
          ))}
        </div>
        <p className="hint">
          已选：<span className="mono">{LEVELS[selfAssessment - 1].name}</span>
          （{LEVELS[selfAssessment - 1].min}–{LEVELS[selfAssessment - 1].max} 分）
        </p>
      </div>

      <div className="row">
        <button className="btn primary" onClick={handleGenerate}>
          生成契约 →
        </button>
      </div>
    </div>
  );
}
