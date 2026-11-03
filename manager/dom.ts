// DOM / 提示的小工具。

import { t } from '../shared/i18n';
import { errText } from '../shared/types';

export const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

/** 显示当前已加载扩展的 manifest 版本,方便确认测的是哪一版 */
export function showVersion(id = 'extVer'): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = `v${chrome.runtime.getManifest().version}`;
}

export function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function showError(e: unknown): void {
  const el = $('err');
  el.hidden = false;
  el.textContent = errText(e);
  const timer = window.setTimeout(() => (el.hidden = true), 6000);
  clearTimeout((el as HTMLElement & { __t?: number }).__t);
  (el as HTMLElement & { __t?: number }).__t = timer;
}

export interface SelectItem {
  id: number | string;
  name: string;
}

export function fillSelect(sel: HTMLSelectElement, items: SelectItem[], presetId: unknown, emptyLabel = t('optDefault')): void {
  const current = sel.value;
  sel.textContent = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = emptyLabel;
  sel.appendChild(opt0);
  for (const it of items) {
    const o = document.createElement('option');
    o.value = String(it.id);
    o.textContent = it.name;
    sel.appendChild(o);
  }
  const want = current || (presetId != null ? String(presetId) : '');
  if (want) sel.value = want;
}

export function shortenUrl(url: string, max = 110): string {
  try {
    const u = new URL(url);
    const s = u.pathname + (u.search || '');
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch {
    return url;
  }
}
