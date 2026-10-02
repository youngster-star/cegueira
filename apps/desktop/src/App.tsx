import { useState } from "react";
import type { ContractBundle } from "@cegueira/contract";
import type { ScoreResult } from "@cegueira/scorer";
import { initialState, type LadderState } from "@cegueira/ladder";
import DirectionScreen from "./screens/DirectionScreen";
import DevelopScreen from "./screens/DevelopScreen";
import ResultScreen from "./screens/ResultScreen";

type Screen = "direction" | "develop" | "result";

const STEPS: { id: Screen; label: string }[] = [
  { id: "direction", label: "方向" },
  { id: "develop", label: "开发" },
  { id: "result", label: "结果" },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>("direction");
  const [bundle, setBundle] = useState<ContractBundle | null>(null);
  const [ladder, setLadder] = useState<LadderState>(initialState());
  const [score, setScore] = useState<ScoreResult | null>(null);

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
          <span className="brand-sub">从失明到复明</span>
        </div>
        <nav className="stepper" aria-label="流程步骤">
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
