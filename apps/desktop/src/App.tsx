import { useEffect, useState } from "react";
import type { ContractBundle } from "@cegueira/contract";
import type { ScoreResult } from "@cegueira/scorer";
import { initialState, type LadderState } from "@cegueira/ladder";
import { createI18n, type Locale } from "@cegueira/i18n";
import DirectionScreen from "./screens/DirectionScreen";
import DevelopScreen from "./screens/DevelopScreen";
import ResultScreen from "./screens/ResultScreen";
import {
  applyTheme,
  loadTheme,
  saveTheme,
  THEME_ORDER,
  type ThemeMode,
} from "./theme";

type Screen = "direction" | "develop" | "result";

const SCREEN_KEY = "ceg.screen";
const LOCALE_KEY = "ceg.locale";

function loadScreen(): Screen {
  try {
    const v = localStorage.getItem(SCREEN_KEY);
    return v === "direction" || v === "develop" || v === "result" ? v : "direction";
  } catch {
    return "direction";
  }
}

function loadLocale(): Locale {
  try {
    return localStorage.getItem(LOCALE_KEY) === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

const THEME_LABEL: Record<ThemeMode, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};

export default function App() {
  const [screen, setScreen] = useState<Screen>(loadScreen);
  const [locale, setLocale] = useState<Locale>(loadLocale);
  const [theme, setTheme] = useState<ThemeMode>(loadTheme);
  const [bundle, setBundle] = useState<ContractBundle | null>(null);
  const [ladder, setLadder] = useState<LadderState>(initialState());
  const [score, setScore] = useState<ScoreResult | null>(null);

  const i18n = createI18n(locale);

  // 窗口/流程状态记忆：当前屏写入 localStorage
  useEffect(() => {
    try {
      localStorage.setItem(SCREEN_KEY, screen);
    } catch {
      /* ignore */
    }
  }, [screen]);

  // 语言偏好记忆
  useEffect(() => {
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      /* ignore */
    }
  }, [locale]);

  // 主题应用
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const cycleTheme = () => {
    setTheme((t) => {
      const next = THEME_ORDER[(THEME_ORDER.indexOf(t) + 1) % THEME_ORDER.length];
      saveTheme(next);
      return next;
    });
  };

  const toggleLocale = () => setLocale((l) => (l === "zh" ? "en" : "zh"));

  const STEPS: { id: Screen; label: string }[] = [
    { id: "direction", label: i18n.t("step.direction") },
    { id: "develop", label: i18n.t("step.develop") },
    { id: "result", label: i18n.t("step.result") },
  ];

  const reset = () => {
    setScreen("direction");
    setBundle(null);
    setLadder(initialState());
    setScore(null);
  };

  const stepIndex = STEPS.findIndex((s) => s.id === screen);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" aria-hidden />
          Cegueira
          <span className="brand-sub">{i18n.t("brand.subtitle")}</span>
        </div>

        <div className="topbar-actions">
          <button className="chip-btn" onClick={toggleLocale} title="切换语言">
            {locale === "zh" ? "EN" : "中"}
          </button>
          <button className="chip-btn" onClick={cycleTheme} title="切换主题">
            {THEME_LABEL[theme]}
          </button>
        </div>

        <nav className="stepper" aria-label={i18n.t("step.flow")}>
          {STEPS.map((s, i) => (
            <div key={s.id} className={`step ${i === stepIndex ? "active" : ""} ${i < stepIndex ? "done" : ""}`}>
              <span className="step-dot">{i < stepIndex ? "✓" : i + 1}</span>
              <span className="step-label">{s.label}</span>
            </div>
          ))}
        </nav>
      </header>

      <main className="content">
        {screen === "direction" && (
          <DirectionScreen
            onGenerated={(b) => {
              setBundle(b);
              setScreen("develop");
            }}
          />
        )}
        {screen === "develop" && bundle && (
          <DevelopScreen
            bundle={bundle}
            ladder={ladder}
            setLadder={setLadder}
            onDone={(s) => {
              setScore(s);
              setScreen("result");
            }}
          />
        )}
        {screen === "result" && score && (
          <ResultScreen score={score} ladder={ladder} onRestart={reset} />
        )}
      </main>
    </div>
  );
}
