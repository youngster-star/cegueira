import { useState } from "react";
import { generateBundle, type ContractBundle } from "@cegueira/contract";
import { LEVELS } from "@cegueira/profile";
import type { TFunc } from "@cegueira/i18n";

const DIRECTIONS = [
  { id: "rag", value: "RAG 问答" },
  { id: "tool", value: "工具调用" },
  { id: "data", value: "数据分析" },
];

interface Props {
  t: TFunc;
  onGenerated: (bundle: ContractBundle) => void;
  initialAssessment?: number;
}

export default function DirectionScreen({ t, onGenerated, initialAssessment }: Props) {
  const [direction, setDirection] = useState(DIRECTIONS[0].value);
  const [selfAssessment, setSelfAssessment] = useState(initialAssessment ?? 3);

  const handleGenerate = () => {
    onGenerated(generateBundle({ direction, selfAssessment: String(selfAssessment) }));
  };

  return (
    <div className="screen">
      <h1>{t("direction.title")}</h1>
      <p className="lead">{t("direction.lead")}</p>

      <div className="card">
        <h2>{t("direction.section1")}</h2>
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
              <div className="dir-title">{t(`direction.${d.id}.label`)}</div>
              <div className="dir-desc">{t(`direction.${d.id}.desc`)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>{t("direction.section2")}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("direction.selfHint")}
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
          {t("direction.selected")}
          <span className="mono">{LEVELS[selfAssessment - 1].name}</span>
          （{LEVELS[selfAssessment - 1].min}–{LEVELS[selfAssessment - 1].max} 分）
        </p>
      </div>

      <div className="row">
        <button className="btn primary" onClick={handleGenerate}>
          {t("direction.generate")} →
        </button>
      </div>
    </div>
  );
}
