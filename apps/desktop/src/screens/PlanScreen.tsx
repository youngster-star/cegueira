import type { ContractBundle } from "@cegueira/contract";
import type { TFunc } from "@cegueira/i18n";

interface Props {
  t: TFunc;
  bundle: ContractBundle;
  source: string;
  degraded: boolean;
  onDevelop: () => void;
}

/** 开发计划屏：系统生成的 PRD + 开发流程 + 技术栈 + 测试集（PRD §6.1 五件套的展示）。 */
export default function PlanScreen({ t, bundle, source, degraded, onDevelop }: Props) {
  const pm = bundle.projectMd;
  const testCount = bundle.evalset.tests.length;
  const mandatory = bundle.rubric.mandatory_tests;

  return (
    <div className="screen">
      <h1>{t("plan.title")}</h1>
      <p className="lead">{t("plan.lead")}</p>

      <p className={degraded ? "hint" : "hint"} style={{ color: degraded ? "var(--warn)" : "var(--ok, #3a9)" }}>
        {degraded ? t("plan.sourceTemplate") : t("plan.sourceLlm")}
        {source ? `（${source}）` : ""}
      </p>

      <div className="card">
        <h2>{t("plan.prd")}</h2>
        <div className="stage-item">
          <div className="dir-title">{pm.title}</div>
        </div>
        <p className="muted" style={{ marginBottom: 4 }}>
          <b>{t("plan.function")}</b>：{pm.coreFunction}
        </p>
        <p className="muted" style={{ marginBottom: 4 }}>
          <b>{t("plan.tech")}</b>：{pm.coreTech}
        </p>
        <p className="muted" style={{ marginBottom: 4 }}>
          <b>{t("plan.env")}</b>：{pm.envPrereq}
        </p>
        <p className="muted" style={{ marginTop: 4 }}>
          <b>{t("plan.hardpart")}</b>：{pm.coreDifficulty}
        </p>
      </div>

      <div className="card">
        <h2>{t("plan.flow")}</h2>
        <div className="stage-list">
          {bundle.contract.stages.map((s) => (
            <div key={s.id} className="stage-item">
              <div className="stage-name">{s.name}</div>
              {s.tasks.map((t) => (
                <span key={t.id} className="task-chip">
                  {t.name}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>{t("plan.tests")}</h2>
        <p className="muted" style={{ margin: 0 }}>
          evalset：{testCount} 条用例（mandatory：{mandatory.join(", ") || "无"}）｜
          checks：{bundle.checks.length} 条 ｜ rubric：{bundle.rubric.rubrics.length} 个维度
        </p>
      </div>

      <div className="row">
        <button className="btn primary" onClick={onDevelop}>
          {t("plan.start")} →
        </button>
      </div>
    </div>
  );
}
