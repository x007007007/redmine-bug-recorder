// DOM / 提示的小工具。

import { errText } from '../shared/types';

export const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

export function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function showError(e: unknown): void {
  const el = $('err');
  el.hidden = false;
  el.textContent = errText(e);
  const t = window.setTimeout(() => (el.hidden = true), 6000);
  clearTimeout((el as HTMLElement & { __t?: number }).__t);
  (el as HTMLElement & { __t?: number }).__t = t;
}

export interface SelectItem {
  id: number | string;
  name: string;
}

export function fillSelect(sel: HTMLSelectElement, items: SelectItem[], presetId: unknown, emptyLabel = '(默认)'): void {
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
