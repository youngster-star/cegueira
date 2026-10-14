import { useState } from "react";
import { LEVELS } from "@cegueira/profile";
import type { TFunc } from "@cegueira/i18n";
import { setApiKey } from "../lib/secret";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  needsKey,
  PROVIDERS,
  saveConnection,
  type Provider,
} from "../lib/connection";

const PLACEHOLDER: Record<string, string> = {
  openai: "sk-...",
  anthropic: "sk-ant-...",
};

interface Props {
  t: TFunc;
  onComplete: (selfAssessment: number) => void;
}

/** 首次运行向导：选模型（含本地 Ollama，免 Key）→ 连接设置 → 技能自评（PRD §3 首次体验）。 */
export default function OnboardingScreen({ t, onComplete }: Props) {
  const [provider, setProvider] = useState<Provider>("ollama");
  const [apiKey, setApiKeyInput] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL.ollama);
  const [model, setModel] = useState(DEFAULT_MODEL.ollama);
  const [selfAssessment, setSelfAssessment] = useState(3);
  const [saving, setSaving] = useState(false);

  const pickProvider = (p: Provider) => {
    setProvider(p);
    setBaseUrl(DEFAULT_BASE_URL[p]);
    setModel(DEFAULT_MODEL[p]);
  };

  const keyMissing = needsKey(provider) && !apiKey.trim();

  const handleStart = async () => {
    if (keyMissing) return;
    setSaving(true);
    try {
      // 云端供应商：Key 存系统密钥库（浏览器预览降级 localStorage）。Ollama 免 Key。
      if (apiKey.trim()) await setApiKey(provider, apiKey.trim());
      saveConnection({ provider, baseUrl: baseUrl.trim(), model: model.trim() });
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
          {PROVIDERS.map((id) => (
            <button
              key={id}
              className={provider === id ? "on" : ""}
              onClick={() => pickProvider(id)}
            >
              {t(`onboard.provider.${id}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>{t("onboard.section2")}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {needsKey(provider) ? t("onboard.keyHint") : t("onboard.keyOptionalHint")}
        </p>

        <label className="muted">{t("onboard.baseUrlLabel")}</label>
        <input
          className="input"
          value={baseUrl}
          placeholder={DEFAULT_BASE_URL[provider] || "https://..."}
          onChange={(e) => setBaseUrl(e.target.value)}
          autoComplete="off"
        />

        <label className="muted" style={{ marginTop: 12, display: "block" }}>
          {t("onboard.modelLabel")}
        </label>
        <input
          className="input"
          value={model}
          placeholder={DEFAULT_MODEL[provider] || "model-name"}
          onChange={(e) => setModel(e.target.value)}
          autoComplete="off"
        />

        {needsKey(provider) && (
          <>
            <label className="muted" style={{ marginTop: 12, display: "block" }}>
              API Key
            </label>
            <input
              className="input"
              type="password"
              value={apiKey}
              placeholder={PLACEHOLDER[provider] ?? t("onboard.customPlaceholder")}
              onChange={(e) => setApiKeyInput(e.target.value)}
              autoComplete="off"
            />
          </>
        )}
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
          disabled={keyMissing || saving}
        >
          {saving ? t("onboard.saving") : t("onboard.start")}
        </button>
      </div>
    </div>
  );
}
