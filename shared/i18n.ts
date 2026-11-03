// 界面与报告文案。扩展页面用 chrome.i18n;单元测试没有浏览器 API,回退到简体中文。

import fallbackMessages from '../_locales/zh_CN/messages.json';

type Bundle = Record<string, { message: string }>;

const fallback = fallbackMessages as Bundle;

export function t(key: string, substitutions?: string | string[]): string {
  const subs = substitutions == null ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];
  const fromBrowser = browserMessage(key, subs);
  if (fromBrowser) return fromBrowser;
  const raw = fallback[key]?.message;
  if (!raw) return key;
  return applySubs(raw, subs);
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
