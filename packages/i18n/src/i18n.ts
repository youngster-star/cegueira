/**
 * i18n 实例：语言切换 + 翻译（含 {var} 插值）+ 缺词回退。
 */
import { enDict, zhDict, type InterpolateParams, type Locale } from "./types.js";

export interface I18n {
  readonly locale: Locale;
  /** 翻译：命中词典返回译文；缺词返回 key 本身（不静默吞掉，便于发现缺词）。 */
  t(key: string, params?: InterpolateParams): string;
}

function dictOf(locale: Locale): Record<string, string> {
  return locale === "zh" ? zhDict : enDict;
}

/** 插值：把 `{name}` 替换为 params 里的值。 */
export function interpolate(template: string, params: InterpolateParams): string {
  let out = template;
  for (const [k, v] of Object.entries(params)) {
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

export function createI18n(locale: Locale): I18n {
  const dict = dictOf(locale);
  return {
    locale,
    t(key, params) {
      const template = dict[key] ?? key;
      return params ? interpolate(template, params) : template;
    },
  };
}

/** 校验词典一致性：中英词条 key 集合一致（避免漏译）。 */
export function diffKeys(a: Record<string, string>, b: Record<string, string>): {
  onlyInA: string[];
  onlyInB: string[];
} {
  const ka = new Set(Object.keys(a));
  const kb = new Set(Object.keys(b));
  return {
    onlyInA: [...ka].filter((k) => !kb.has(k)),
    onlyInB: [...kb].filter((k) => !ka.has(k)),
  };
}
