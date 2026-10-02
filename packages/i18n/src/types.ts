/**
 * P5 i18n：中英文词典与翻译函数（PRD §3 本地化）。
 */

export type Locale = "zh" | "en";

export type Dict = Record<string, string>;

export type InterpolateParams = Record<string, string | number>;

/** 中文词典（覆盖桌面 GUI 核心文案）。 */
export const zhDict: Dict = {
  "brand.subtitle": "从失明到复明",
  "step.direction": "方向",
  "step.develop": "开发",
  "step.result": "结果",
  "step.flow": "流程步骤",

  "direction.title": "选择项目方向",
  "direction.subtitle": "根据你的技能自评推荐合适方向",
  "direction.selfLevel": "技能自评（0–10）",
  "direction.preference": "偏好（可选）",
  "direction.generate": "生成契约",

  "develop.title": "开发中",
  "develop.contractOverview": "契约概览",
  "develop.ladder": "辅助阶梯",
  "develop.stuck": "卡住了",
  "develop.upgrade": "升级到 {level}",
  "develop.submit": "提交评分",
  "develop.explainL4": "用自己的话解释",

  "result.title": "结果",
  "result.score": "最终得分",
  "result.dimensions": "四维得分",
  "result.gates": "门控",
  "result.profile": "画像",
  "result.restart": "重新开始",

  "ladder.unknown": "不知道",
  "common.ok": "确定",
  "common.cancel": "取消",
};

/** 英文词典。 */
export const enDict: Dict = {
  "brand.subtitle": "From Blindness to Insight",
  "step.direction": "Direction",
  "step.develop": "Develop",
  "step.result": "Result",
  "step.flow": "Steps",

  "direction.title": "Choose a direction",
  "direction.subtitle": "Recommendations based on your self-assessment",
  "direction.selfLevel": "Skill self-assessment (0–10)",
  "direction.preference": "Preference (optional)",
  "direction.generate": "Generate contract",

  "develop.title": "Developing",
  "develop.contractOverview": "Contract overview",
  "develop.ladder": "Assist ladder",
  "develop.stuck": "Stuck",
  "develop.upgrade": "Upgrade to {level}",
  "develop.submit": "Submit for scoring",
  "develop.explainL4": "Explain in your own words",

  "result.title": "Result",
  "result.score": "Final score",
  "result.dimensions": "Dimensions",
  "result.gates": "Gates",
  "result.profile": "Profile",
  "result.restart": "Restart",

  "ladder.unknown": "I don't know",
  "common.ok": "OK",
  "common.cancel": "Cancel",
};
