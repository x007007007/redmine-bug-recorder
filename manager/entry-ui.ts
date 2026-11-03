// 时间线条目行构建:操作行(勾选/截图+点击标记/删除)、API 行(可展开请求/响应体)、Pinia 行。

import { fmtClock, describeAction, describeElement, describeLog, describePiniaEvent } from '../shared/describe';
import { shortenUrl } from './dom';
import type { ChangeNote, LogEntry, RecordedAction, PiniaEvent, RequestEntry } from '../shared/types';

export interface ActionRowOpts {
  num: number;
  selected: boolean;
  propsDiff?: { changes: string[] };
  onToggle: (id: number, checked: boolean) => void;
  onDelete: (a: RecordedAction) => void;
  onZoom: (a: RecordedAction) => void;
}

export function buildActionRow(a: RecordedAction, opts: ActionRowOpts): HTMLDivElement {
  const { num, selected, onToggle, onDelete, onZoom } = opts;
  const row = document.createElement('div');
  row.className = 'step entry';
  if (!selected) row.classList.add('off');

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'step-cb';
  cb.checked = selected;
  cb.disabled = typeof a.id !== 'number';
  cb.addEventListener('change', () => {
    if (typeof a.id !== 'number') return;
    onToggle(a.id, cb.checked);
  });

  const time = document.createElement('span');
  time.className = 'entry-time';
  time.textContent = fmtClock(a.ts);

  const body = document.createElement('div');
  body.className = 'body';
  const what = document.createElement('div');
  what.className = 'what';
  what.textContent = `${num ? num + '. ' : ''}${describeAction(a)}`;
  body.appendChild(what);

  const sub = document.createElement('div');
  sub.className = 'sub';
  const chunks: Node[] = [];
  if (a.selector) {
    const code = document.createElement('code');
    code.textContent = a.selector;
    chunks.push(code);
  }
  if (a.kind === 'click' && a.href) chunks.push(document.createTextNode(`→ ${a.href}`));
  if (a.value) chunks.push(document.createTextNode(`值: ${String(a.value).slice(0, 120)}`));
  if (!chunks.length) sub.textContent = '\u00a0';
  chunks.forEach((node, index) => {
    if (index > 0) sub.appendChild(document.createTextNode(' · '));
    sub.appendChild(node);
  });
  body.appendChild(sub);

  const badges = buildBadges(a, opts.propsDiff);
  if (badges) body.appendChild(badges);

  const img = document.createElement('img');
  let marker: HTMLSpanElement | null = null;
  if (a.screenshot) {
    img.src = a.screenshot;
    img.title = `小步骤 ${num} 截图`;
    img.addEventListener('click', () => onZoom(a));
    // 半透明点击标记覆盖层(按视口比例定位)
    if (a.point && a.viewport) {
      marker = document.createElement('span');
      marker.className = 'shot-marker';
      marker.style.left = (a.point.x / a.viewport.w) * 100 + '%';
      marker.style.top = (a.point.y / a.viewport.h) * 100 + '%';
      marker.title = `点击位置 (${a.point.x}, ${a.point.y})`;
    }
  } else {
    img.className = 'none';
    img.alt = '';
  }

  const del = document.createElement('button');
  del.className = 'del-btn';
  del.textContent = '✕';
  del.title = '删除该步骤';
  del.addEventListener('click', () => onDelete(a));

  row.append(cb, time, body, img, del);
  if (marker) {
    const wrap = document.createElement('span');
    wrap.className = 'shot-wrap';
    row.replaceChild(wrap, img);
    wrap.append(img, marker);
  }
  return row;
}

function buildBadges(a: RecordedAction, propsDiff?: { changes: string[] }): HTMLDivElement | null {
  if (!a.vue) return null;
  const wrap = document.createElement('div');
  wrap.className = 'badges';
  if (a.vue.component) {
    const comp = document.createElement('span');
    comp.className = 'badge vue';
    comp.textContent = `Vue: ${a.vue.component}`;
    comp.title = a.vue.chain && a.vue.chain.length > 1 ? `组件链 (${a.vue.chain.join(' > ')})` : '';
    wrap.appendChild(comp);
  }
  if (a.vue.props) {
    const changes = propsDiff && propsDiff.changes ? propsDiff.changes : [];
    const det = document.createElement('details');
    det.className = 'badge props';
    const s = document.createElement('summary');
    s.textContent = changes.length ? `props (${changes.length} 处变化)` : 'props';
    det.appendChild(s);
    const pre = document.createElement('div');
    pre.className = 'props-body';
    pre.textContent = a.vue.props + (changes.length ? `\n\n与上次相比:\n${changes.join('\n')}` : '');
    det.appendChild(pre);
    wrap.appendChild(det);
  }
  if (a.vue.piniaChanges && a.vue.piniaChanges.length) {
    const pin = document.createElement('span');
    pin.className = 'badge pinia';
    const changed = a.vue.piniaChanges.filter((c) => !c.firstSeen);
    pin.textContent = changed.length ? `Pinia ${changed.length} 变化` : 'Pinia 首次 变化';
    pin.title = a.vue.piniaChanges.map((c) => `${c.storeId}: ${c.state.slice(0, 200)}`).join('\n');
    wrap.appendChild(pin);
  }
  return wrap.children.length ? wrap : null;
}

export function buildRequestRow(r: RequestEntry): HTMLDetailsElement {
  const d = document.createElement('details');
  d.className = 'req entry-request' + (r.error || (r.status && r.status >= 400) ? ' bad' : '');
  if (r.id != null) d.dataset.id = String(r.id);

  const sum = document.createElement('summary');
  const time = document.createElement('span');
  time.className = 'entry-time';
  time.textContent = fmtClock(r.ts);
  const m = document.createElement('span');
  m.className = 'method';
  m.textContent = r.method;
  const u = document.createElement('span');
  u.className = 'u';
  u.textContent = shortenUrl(r.url);
  u.title = r.url;
  const pill = document.createElement('span');
  if (r.error) {
    pill.className = 'status-pill err';
    pill.textContent = r.error.slice(0, 24);
  } else {
    pill.className = 'status-pill' + (r.status && r.status >= 400 ? ' bad' : '');
    pill.textContent = String(r.status || '?');
  }
  const dur = document.createElement('span');
  dur.className = 'count';
  dur.textContent = r.durationMs != null ? `${r.durationMs}ms` : '';
  sum.append(time, m, u, pill, dur);

  const pre1 = document.createElement('pre');
  pre1.textContent = `请求体:\n${r.requestBody || '(空 / 未捕获)'}`;
  const pre2 = document.createElement('pre');
  if (r.responseBody !== undefined) {
    pre2.textContent = `响应体:\n${r.responseBody === null ? '(非文本内容,不展示)' : r.responseBody || '(空)'}`;
  } else {
    pre2.textContent = '响应体:未捕获(需开启"捕获 API 请求/响应体",仅 Chrome)';
  }
  d.append(sum, pre1, pre2);
  return d;
}

export function buildLogRow(log: LogEntry): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'entry entry-log ' + log.level;
  const time = document.createElement('span');
  time.className = 'entry-time';
  time.textContent = fmtClock(log.ts);
  const line = document.createElement('span');
  line.className = 'log-line';
  line.textContent = describeLog(log);
  row.append(time, line);
  return row;
}

export function buildNoteRow(note: ChangeNote): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'entry entry-note';
  const time = document.createElement('span');
  time.className = 'entry-time';
  time.textContent = fmtClock(note.ts);
  const line = document.createElement('span');
  line.className = 'note-line';
  line.textContent = `修改意见 ${describeElement(note)} → ${note.opinion}`;
  row.append(time, line);
  return row;
}

export function buildPiniaRow(ev: PiniaEvent): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'entry entry-pinia';
  const time = document.createElement('span');
  time.className = 'entry-time';
  time.textContent = fmtClock(ev.ts);
  const line = document.createElement('span');
  line.className = 'pinia-line';
  line.textContent = describePiniaEvent(ev);
  row.append(time, line);
  return row;
}
