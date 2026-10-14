import { useState } from "react";
import type { ContractBundle } from "@cegueira/contract";
import { LEVELS } from "@cegueira/profile";
import type { TFunc } from "@cegueira/i18n";
import { backend } from "../lib/backend";

const DIRECTIONS = [
  { id: "rag", value: "RAG 问答" },
  { id: "tool", value: "工具调用" },
  { id: "data", value: "数据分析" },
];

export interface ContractMeta {
  dir: string;
  contractPath: string;
  rubricPath: string;
  evalsetPath: string;
}

interface Props {
  t: TFunc;
  onGenerated: (bundle: ContractBundle, meta: ContractMeta) => void;
  initialAssessment?: number;
}

export default function DirectionScreen({ t, onGenerated, initialAssessment }: Props) {
  const [direction, setDirection] = useState(DIRECTIONS[0].value);
  const [selfAssessment, setSelfAssessment] = useState(initialAssessment ?? 3);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setError(null);
    setGenerating(true);
    try {
      // 调用本地 sidecar 的真实契约生成器（与 `ceg init` 同一引擎）。
      const r = await backend.init(direction);
      onGenerated(r.bundle, {
        dir: r.dir,
        contractPath: r.paths.contract,
        rubricPath: r.paths.rubric,
        evalsetPath: r.paths.evalset,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
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
              aria-pressed={direction === d.value}
              aria-label={t(`direction.${d.id}.label`)}
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

      {error && (
        <p className="hint" style={{ color: "var(--warn)" }}>
          {t("common.error")}
          {error}
        </p>
      )}

      <div className="row">
        <button className="btn primary" onClick={handleGenerate} disabled={generating}>
          {generating ? t("direction.generating") : t("direction.generate")} →
        </button>
      </div>
    </div>
  );
}
