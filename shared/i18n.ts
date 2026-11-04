// 界面与报告文案。浏览器不会替换 HTML 里的 __MSG__。
// 语言优先用配置里的选择;选「跟随浏览器」时才用 chrome.i18n。单元测试没有浏览器 API,回退到简体中文。

import enMessages from '../_locales/en/messages.json';
import zhMessages from '../_locales/zh_CN/messages.json';

export type LocalePref = 'auto' | 'zh_CN' | 'en';

const LOCALE_KEY = 'bugrec.locale';
const MSG = /__MSG_(\w+)__/g;

type Bundle = Record<string, { message: string }>;

const zh = zhMessages as Bundle;
const en = enMessages as Bundle;
const fallback = zh;

let pref: LocalePref = readStoredPref();

export function currentLocale(): LocalePref {
  return pref;
}

export function isLocalePref(value: unknown): value is LocalePref {
  return value === 'auto' || value === 'zh_CN' || value === 'en';
}

export function useLocale(next: LocalePref): void {
  pref = next;
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCALE_KEY, next);
  } catch {
    /* 取不到本地存储时只改当前这次运行 */
  }
  document.documentElement.lang = resolvedLang();
}

export function t(key: string, substitutions?: string | string[]): string {
  const subs = substitutions == null ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];
  const chosen = catalog();
  if (chosen) {
    const raw = chosen[key]?.message;
    if (raw) return applySubs(raw, subs);
  }
  const fromBrowser = browserMessage(key, subs);
  if (fromBrowser) return fromBrowser;
  const raw = fallback[key]?.message;
  if (!raw) return key;
  return applySubs(raw, subs);
}

/** 把页面上残留的 __MSG_key__ 换成当前语言。要在绑定事件之前调用。 */
export function applyDomI18n(): void {
  if (typeof document === 'undefined' || !document.body) return;
  document.documentElement.lang = resolvedLang();
  if (document.title.includes('__MSG_')) document.title = replaceMsg(document.title);
  const texts: Text[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    const parent = text.parentElement;
    const isSkipped = parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE');
    if (!isSkipped && text.nodeValue && text.nodeValue.includes('__MSG_')) texts.push(text);
    node = walker.nextNode();
  }
  for (const text of texts) text.nodeValue = replaceMsg(text.nodeValue || '');
  for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
    for (const attr of [...el.attributes]) {
      if (!attr.value.includes('__MSG_')) continue;
      el.setAttribute(attr.name, replaceMsg(attr.value));
    }
  }
}

export function watchLocale(): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.recorderSettings) return;
    const next = (changes.recorderSettings.newValue as { locale?: unknown } | undefined)?.locale;
    if (!isLocalePref(next) || next === pref) return;
    useLocale(next);
    location.reload();
  });
}

/** 配置存在 chrome.storage、页面却还停在旧语言时,刷新一次。返回 true 表示已经开始刷新。 */
export async function syncLocaleFromStorage(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return false;
  const bag = (await chrome.storage.local.get('recorderSettings')) as {
    recorderSettings?: { locale?: unknown };
  };
  const next = bag.recorderSettings?.locale;
  if (!isLocalePref(next) || next === pref) return false;
  useLocale(next);
  location.reload();
  return true;
}

export function bootI18n(): void {
  if (typeof document === 'undefined') return;
  const run = (): void => {
    applyDomI18n();
    watchLocale();
    void syncLocaleFromStorage();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
}

function catalog(): Bundle | null {
  if (pref === 'en') return en;
  if (pref === 'zh_CN') return zh;
  return null;
}

function readStoredPref(): LocalePref {
  if (typeof window === 'undefined') return 'auto';
  try {
    const value = localStorage.getItem(LOCALE_KEY);
    if (isLocalePref(value)) return value;
  } catch {
    /* 取不到本地存储时跟随浏览器 */
  }
  return 'auto';
}

function resolvedLang(): string {
  if (pref === 'en') return 'en';
  if (pref === 'zh_CN') return 'zh-CN';
  const ui = globalThis.chrome?.i18n?.getUILanguage?.() || '';
  return ui || 'zh-CN';
}

function replaceMsg(value: string): string {
  return value.replace(MSG, (_all, key: string) => t(key));
}

function browserMessage(key: string, subs: string[]): string {
  const getMessage = globalThis.chrome?.i18n?.getMessage;
  if (!getMessage) return '';
  const value = subs.length ? getMessage(key, subs) : getMessage(key);
  return value || '';
}

function applySubs(raw: string, subs: string[]): string {
  return raw.replace(/\$(\d+)/g, (_match, index: string) => subs[Number(index) - 1] ?? '');
}
