import { useState } from "react";
import { LEVELS } from "@cegueira/profile";
import { setApiKey } from "../lib/secret";

const PROVIDERS = [
  { id: "openai", label: "OpenAI", placeholder: "sk-..." },
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-..." },
  { id: "custom", label: "其他（自定义）", placeholder: "你的 API Key" },
];

interface Props {
  onComplete: (selfAssessment: number) => void;
}

/** 首次运行向导：选模型 → 填 API Key → 技能自评（PRD §3 首次体验）。 */
export default function OnboardingScreen({ onComplete }: Props) {
  const [provider, setProvider] = useState(PROVIDERS[0].id);
  const [apiKey, setApiKeyInput] = useState("");
  const [selfAssessment, setSelfAssessment] = useState(3);
  const [saving, setSaving] = useState(false);

  const selected = PROVIDERS.find((p) => p.id === provider)!;

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
      <h1>欢迎使用 Cegueira</h1>
      <p className="lead">三步完成初始设置，即可开始你的 Agent 实战陪练。</p>

      <div className="card">
        <h2>① 选择模型供应商</h2>
        <div className="seg">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              className={provider === p.id ? "on" : ""}
              onClick={() => setProvider(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>② 填入 API Key</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          采用 BYO Key 模式，Key 将加密存入系统密钥库，不会明文落盘。评测前会给出成本预估并请你确认。
        </p>
        <input
          className="input"
          type="password"
          value={apiKey}
          placeholder={selected.placeholder}
          onChange={(e) => setApiKeyInput(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="card">
        <h2>③ 技能自评</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          对照下表诚实评估当前水平，用于初始化你的技能画像。
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
        <button
          className="btn primary"
          onClick={handleStart}
          disabled={!apiKey.trim() || saving}
        >
          {saving ? "保存中…" : "开始练习 →"}
        </button>
      </div>
    </div>
  );
}
