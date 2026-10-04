import { useState } from "react";
import { LEVELS } from "@cegueira/profile";
import type { TFunc } from "@cegueira/i18n";
import { setApiKey } from "../lib/secret";

const PROVIDER_IDS = ["openai", "anthropic", "custom"] as const;

const PLACEHOLDER: Record<string, string> = {
  openai: "sk-...",
  anthropic: "sk-ant-...",
};

interface Props {
  t: TFunc;
  onComplete: (selfAssessment: number) => void;
}

/** 首次运行向导：选模型 → 填 API Key → 技能自评（PRD §3 首次体验）。 */
export default function OnboardingScreen({ t, onComplete }: Props) {
  const [provider, setProvider] = useState<(typeof PROVIDER_IDS)[number]>(PROVIDER_IDS[0]);
  const [apiKey, setApiKeyInput] = useState("");
  const [selfAssessment, setSelfAssessment] = useState(3);
  const [saving, setSaving] = useState(false);

  const handleStart = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await setApiKey(provider, apiKey.trim());
      onComplete(selfAssessment);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="screen">
      <h1>{t("onboard.welcome")}</h1>
      <p className="lead">{t("onboard.lead")}</p>

      <div className="card">
        <h2>{t("onboard.section1")}</h2>
        <div className="seg">
          {PROVIDER_IDS.map((id) => (
            <button
              key={id}
              className={provider === id ? "on" : ""}
              onClick={() => setProvider(id)}
            >
              {t(`onboard.provider.${id}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>{t("onboard.section2")}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("onboard.keyHint")}
        </p>
        <input
          className="input"
          type="password"
          value={apiKey}
          placeholder={PLACEHOLDER[provider] ?? t("onboard.customPlaceholder")}
          onChange={(e) => setApiKeyInput(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="card">
        <h2>{t("onboard.section3")}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("onboard.selfHint")}
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
        <button
          className="btn primary"
          onClick={handleStart}
          disabled={!apiKey.trim() || saving}
        >
          {saving ? t("onboard.saving") : t("onboard.start")}
        </button>
      </div>
    </div>
  );
}
