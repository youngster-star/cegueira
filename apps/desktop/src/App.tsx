import { useEffect, useMemo, useState } from "react";
import type { ContractBundle } from "@cegueira/contract";
import type { ScoreResult } from "@cegueira/scorer";
import { initialState, type LadderState } from "@cegueira/ladder";
import { createI18n, type Locale } from "@cegueira/i18n";
import CommandPalette from "./components/CommandPalette";
import type { Command } from "./lib/commands";
import DirectionScreen from "./screens/DirectionScreen";
import DevelopScreen from "./screens/DevelopScreen";
import OnboardingScreen from "./screens/OnboardingScreen";
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
const ONBOARD_KEY = "ceg.onboarded";
const SELF_KEY = "ceg.selfAssessment";

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

function loadOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARD_KEY) === "1";
  } catch {
    return false;
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
  const [onboarded, setOnboarded] = useState<boolean>(loadOnboarded);
  const [selfAssessment, setSelfAssessment] = useState<number>(3);
  const [bundle, setBundle] = useState<ContractBundle | null>(null);
  const [ladder, setLadder] = useState<LadderState>(initialState());
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

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

  // 命令面板快捷键：Ctrl/Cmd+K 切换
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cycleTheme = () => {
    setTheme((t) => {
      const next = THEME_ORDER[(THEME_ORDER.indexOf(t) + 1) % THEME_ORDER.length];
      saveTheme(next);
      return next;
    });
  };

  const toggleLocale = () => setLocale((l) => (l === "zh" ? "en" : "zh"));

  const handleOnboarded = (level: number) => {
    setSelfAssessment(level);
    try {
      localStorage.setItem(ONBOARD_KEY, "1");
      localStorage.setItem(SELF_KEY, String(level));
    } catch {
      /* ignore */
    }
    setOnboarded(true);
  };

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

  // 命令面板命令列表（随状态动态构建）
  const commands = useMemo<Command[]>(
    () => [
      { id: "theme", label: i18n.t("palette.theme"), hint: THEME_LABEL[theme] },
      { id: "locale", label: i18n.t("palette.locale"), hint: locale === "zh" ? "English" : "中文" },
      { id: "goto-direction", label: i18n.t("palette.gotoDirection") },
      { id: "goto-develop", label: i18n.t("palette.gotoDevelop"), disabled: !bundle },
      { id: "goto-result", label: i18n.t("palette.gotoResult"), disabled: !score },
      { id: "restart", label: i18n.t("palette.restart") },
    ],
    [i18n, locale, theme, bundle, score],
  );

  const handleRunCommand = (cmd: Command) => {
    switch (cmd.id) {
      case "theme":
        cycleTheme();
        break;
      case "locale":
        toggleLocale();
        break;
      case "goto-direction":
        setScreen("direction");
        break;
      case "goto-develop":
        if (bundle) setScreen("develop");
        break;
      case "goto-result":
        if (score) setScreen("result");
        break;
      case "restart":
        reset();
        break;
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.id === screen);

  if (!onboarded) {
    return (
      <div className="app">
        <main className="content">
          <OnboardingScreen t={i18n.t} onComplete={handleOnboarded} />
        </main>
      </div>
    );
  }

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
            t={i18n.t}
            initialAssessment={selfAssessment}
            onGenerated={(b) => {
              setBundle(b);
              setScreen("develop");
            }}
          />
        )}
        {screen === "develop" && bundle && (
          <DevelopScreen
            t={i18n.t}
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
          <ResultScreen t={i18n.t} score={score} ladder={ladder} onRestart={reset} />
        )}
      </main>

      {paletteOpen && (
        <CommandPalette
          commands={commands}
          onRun={handleRunCommand}
          onClose={() => setPaletteOpen(false)}
          placeholder={i18n.t("palette.placeholder")}
          emptyText={i18n.t("palette.empty")}
        />
      )}
    </div>
  );
}
