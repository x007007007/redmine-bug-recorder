// DOM / 提示的小工具。

export const $ = (id) => document.getElementById(id);

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function showError(e) {
  const el = $('err');
  el.hidden = false;
  el.textContent = String((e && e.message) || e);
  clearTimeout(el.__t);
  el.__t = setTimeout(() => (el.hidden = true), 6000);
}

export function fillSelect(sel, items, presetId, emptyLabel) {
  const current = sel.value;
  sel.textContent = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = emptyLabel || '(默认)';
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

export function shortenUrl(url, max = 110) {
  try {
    const u = new URL(url);
    const s = u.pathname + (u.search || '');
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch {
    return url;
  }
}
