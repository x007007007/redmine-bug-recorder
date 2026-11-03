// 页面(大步骤)分组 DOM 构建:头部(折叠/全选/标题/整页删除)+ 统一时间线条目。
// 纯构建逻辑,交互回调由 steps-ui 通过 handlers 注入,避免模块循环。

import { entryVisible, type CaptureView, type ListOrigin } from '../shared/timeline';
import { esc } from './dom';
import { buildActionRow, buildRequestRow, buildLogRow, buildNoteRow, buildPiniaRow } from './entry-ui';
import type { PageGroup, RecordedAction } from '../shared/types';

export interface PageCtx {
  propsDiffs: Map<number | undefined, { changes: string[] }>;
  shots: Map<number | undefined, string>;
  tabMap: Map<number, number>;
  multiTab: boolean;
  listOrigin: ListOrigin;
  captureView: CaptureView;
}

export interface PageHandlers {
  isCollapsed: (p: PageGroup) => boolean;
  isSelected: (a: RecordedAction) => boolean;
  onToggleCollapse: (p: PageGroup) => void;
  onTogglePage: (p: PageGroup, checked: boolean) => void;
  onToggleAction: (id: number, checked: boolean) => void;
  onDeleteAction: (a: RecordedAction) => void;
  onDeletePage: (p: PageGroup) => void;
  onZoom: (a: RecordedAction) => void;
}

export function buildPageGroup(p: PageGroup, ctx: PageCtx, h: PageHandlers): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'page-group' + (h.isCollapsed(p) ? ' collapsed' : '');
  if (p.pseudo) group.classList.add('pseudo');

  group.appendChild(buildHead(p, ctx, h));

  const bodyEl = document.createElement('div');
  bodyEl.className = 'page-body';
  const numOf = stepNumbers(p);
  for (const e of p.entries) {
    if (!entryVisible(e, ctx.listOrigin, ctx.captureView)) continue;
    if (e.type === 'action') {
      bodyEl.appendChild(
        buildActionRow(e.data, {
          num: numOf.get(e.data.id!) || 0,
          selected: h.isSelected(e.data),
          propsDiff: ctx.propsDiffs.get(e.data.id),
          onToggle: h.onToggleAction,
          onDelete: h.onDeleteAction,
          onZoom: h.onZoom,
        })
      );
    } else if (e.type === 'request') {
      bodyEl.appendChild(buildRequestRow(e.data));
    } else if (e.type === 'log') {
      bodyEl.appendChild(buildLogRow(e.data));
    } else if (e.type === 'note') {
      bodyEl.appendChild(buildNoteRow(e.data));
    } else {
      bodyEl.appendChild(buildPiniaRow(e.data));
    }
  }
  group.appendChild(bodyEl);
  return group;
}

function buildHead(p: PageGroup, ctx: PageCtx, h: PageHandlers): HTMLDivElement {
  const head = document.createElement('div');
  head.className = 'page-head';

  const caret = document.createElement('button');
  caret.className = 'caret';
  caret.textContent = h.isCollapsed(p) ? '▸' : '▾';
  caret.title = '折叠 / 展开';
  caret.addEventListener('click', () => h.onToggleCollapse(p));
  head.appendChild(caret);

  if (!p.pseudo) {
    const selectable = p.actions.filter((a) => typeof a.id === 'number');
    const selCount = selectable.filter((a) => h.isSelected(a)).length;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'page-cb';
    cb.checked = selectable.length > 0 && selCount === selectable.length;
    cb.indeterminate = selCount > 0 && selCount < selectable.length;
    cb.disabled = selectable.length === 0;
    cb.title = `勾选该页步骤(已选 ${selCount}/${selectable.length})`;
    cb.addEventListener('change', () => h.onTogglePage(p, cb.checked));
    head.appendChild(cb);
  }

  const title = document.createElement('span');
  title.className = 'page-title';
  const clock = `${fmt2(p.startTime)}${p.endTime > p.startTime ? ` ~ ${fmt2(p.endTime)}` : ''}`;
  const tab = ctx.multiTab && p.tabId != null ? ` · 标签页 ${ctx.tabMap.get(p.tabId) || '?'}` : '';
  const counts = p.entries.filter((e) => e.type === 'action').length;
  const apiCount = p.entries.filter((e) => e.type === 'request').length;
  const logCount = p.entries.filter((e) => e.type === 'log').length;
  const navShot = p.actions.find((a) => a.kind === 'navigate');
  const shot = navShot ? ctx.shots.get(navShot.id) : null;
  title.innerHTML =
    `📄 <b>大步骤 ${p.orderIndex}</b> · ${esc(p.url)}` +
    (p.title ? ` <span class="count">(${esc(p.title)})</span>` : '') +
    ` <span class="count">· ${clock}${tab} · ${counts} 步 / ${apiCount} API${logCount ? ` / ${logCount} Console` : ''}${shot ? ' · 整页截图 ✓' : ''}</span>`;
  head.appendChild(title);

  const delPage = document.createElement('button');
  delPage.className = 'del-btn';
  delPage.textContent = '🗑 删除整页';
  delPage.title = '删除该页所有记录(步骤/API/Pinia)';
  delPage.addEventListener('click', () => h.onDeletePage(p));
  head.appendChild(delPage);

  return head;
}

/** 小步骤编号:跳过作为页面标题的 navigate */
function stepNumbers(p: PageGroup): Map<number, number> {
  const nav = p.actions.find((a) => a.kind === 'navigate');
  let n = 0;
  const numOf = new Map<number, number>();
  for (const a of p.actions) {
    if (a.kind === 'navigate' && a === nav) continue;
    numOf.set(a.id!, ++n);
  }
  return numOf;
}

function fmt2(ts: number): string {
  const d = new Date(ts);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
