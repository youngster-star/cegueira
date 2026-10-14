import { useState } from "react";
import type { ContractBundle } from "@cegueira/contract";
import { LEVELS } from "@cegueira/profile";
import type { TFunc } from "@cegueira/i18n";
import { backend } from "../lib/backend";
import { loadConnection } from "../lib/connection";
import { getApiKey } from "../lib/secret";

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
  source: string;
  degraded: boolean;
}

interface Props {
  t: TFunc;
  onGenerated: (bundle: ContractBundle, meta: ContractMeta) => void;
  initialAssessment?: number;
}

const DIFF_LABEL = (d: number): string =>
  d <= 3 ? "入门" : d <= 6 ? "进阶" : d <= 8 ? "熟练" : "挑战";

export default function DirectionScreen({ t, onGenerated, initialAssessment }: Props) {
  const [direction, setDirection] = useState(DIRECTIONS[0].value);
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState(5);
  const [selfAssessment, setSelfAssessment] = useState(initialAssessment ?? 3);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setError(null);
    setGenerating(true);
    try {
      // 取首启向导里配置的连接；Ollama 免 Key，云端取密钥库中的 Key。
      const conn = loadConnection();
      const apiKey = (await getApiKey(conn.provider)) ?? undefined;
      const r = await backend.init({
        direction,
        topic: topic.trim() || undefined,
        difficulty,
        selfAssessment: String(selfAssessment),
        llm: { provider: conn.provider, baseUrl: conn.baseUrl, model: conn.model, apiKey },
      });
      onGenerated(r.bundle, {
        dir: r.dir,
        contractPath: r.paths.contract,
        rubricPath: r.paths.rubric,
        evalsetPath: r.paths.evalset,
        source: r.source,
        degraded: r.degraded,
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

        <label className="muted" style={{ marginTop: 14, display: "block" }}>
          {t("direction.topic")}
        </label>
        <input
          className="input"
          value={topic}
          placeholder={t("direction.topicPlaceholder")}
          onChange={(e) => setTopic(e.target.value)}
          autoComplete="off"
        />

        <label className="muted" style={{ marginTop: 14, display: "block" }}>
          {t("direction.difficulty")}：<b>{difficulty}</b> · {DIFF_LABEL(difficulty)}
        </label>
        <input
          type="range"
          min={1}
          max={10}
          value={difficulty}
          onChange={(e) => setDifficulty(Number(e.target.value))}
          style={{ width: "100%" }}
        />
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
        <p className="hint" style={{ color: "var(--warn)", whiteSpace: "pre-wrap" }}>
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
