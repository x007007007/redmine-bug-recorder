// 面板 · 时间轴缩略图与大步骤分页列表的视图渲染/交互(定位/选范围/勾选)。

import { $ } from '../manager/dom';
import { t } from '../shared/i18n';
import { buildPages, filterVisiblePages, sortPages } from '../shared/timeline';
import { describeAction } from '../shared/describe';
import { renderPages, PAGE_SIZE, clockOf, type PageRow } from './panel-pages';
import { panelState } from './panel-state';
import type { PageGroup, RecordedAction } from '../shared/types';

interface ViewHooks {
  persistSelection: () => void;
  submitRange: () => void;
}

const hooks: ViewHooks = { persistSelection: () => {}, submitRange: () => {} };

/** 面板主体注入:勾选持久化(SET_SELECTION)与按范围提交 */
export function bindView(h: ViewHooks): void {
  Object.assign(hooks, h);
}

export function renderTimeline(): void {
  const box = $('timeline');
  box.textContent = '';
  if (!panelState.cache || !panelState.cache.actions.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = t('timelineEmpty');
    box.appendChild(empty);
    return;
  }
  const inRangeTs = (ts: number): boolean =>
    !!panelState.range && ts >= panelState.range.fromTs && ts <= panelState.range.toTs;
  for (const a of panelState.cache.actions) {
    if (!a.screenshot) continue;
    const thumb = document.createElement('div');
    thumb.className = 'thumb' + (inRangeTs(a.ts) ? ' in-range' : '');
    thumb.title = `${clockOf(a.ts)} ${describeAction(a)}`;
    const img = document.createElement('img');
    img.src = a.screenshot;
    const cap = document.createElement('span');
    cap.className = 'cap';
    cap.textContent = clockOf(a.ts);
    thumb.append(img, cap);
    thumb.addEventListener('click', () => onThumbClick(a));
    box.appendChild(thumb);
  }
}

export function onThumbClick(a: RecordedAction): void {
  if (panelState.rangeMode) {
    if (panelState.rangeFromTs == null) {
      panelState.rangeFromTs = a.ts; // 第一下:起点
      panelState.range = null;
      $('rangeInfo').textContent = t('rangeStart', clockOf(a.ts));
      $('btnClearRange').hidden = false;
      renderTimeline();
      return;
    }
    const from = Math.min(panelState.rangeFromTs, a.ts);
    const to = Math.max(panelState.rangeFromTs, a.ts);
    panelState.range = { sessionId: panelState.sessionId || '', fromTs: from, toTs: to };
    const n = panelState.cache!.actions.filter((x) => x.ts >= from && x.ts <= to).length;
    $('rangeInfo').textContent = t('rangeSpan', [clockOf(from), clockOf(to), String(n)]);
    $('btnSubmitRange').hidden = false;
    renderTimeline();
    return;
  }
  locate(a.ts);
}

export function clearRange(): void {
  panelState.range = null;
  panelState.rangeFromTs = null;
  $('rangeInfo').textContent = panelState.rangeMode ? t('rangeHow') : t('rangeHint');
  $('btnClearRange').hidden = true;
  $('btnSubmitRange').hidden = true;
  renderTimeline();
}

export function updateSelSummary(): void {
  const acts = panelState.cache?.actions ?? [];
  const sel = acts.filter((a) => panelState.selected.has(a.id!));
  const shots = sel.filter((a) => a.screenshot).length;
  $('selSummary').textContent = acts.length ? t('selShots', [String(sel.length), String(acts.length), String(shots)]) : '';
}

/* ---------- 大步骤分页列表 ---------- */

export function renderPagesPage(): void {
  const slice = panelState.pages.slice(panelState.pageIdx * PAGE_SIZE, (panelState.pageIdx + 1) * PAGE_SIZE);
  renderPages($('pages'), slice, {
    highlightKey: panelState.highlightKey,
    isSelected: (id) => panelState.selected.has(id),
    onTogglePage,
    listOrigin: panelState.listOrigin,
    captureView: panelState.captureView,
  });
}

function onTogglePage(p: PageGroup, checked: boolean): void {
  for (const a of p.actions) {
    if (typeof a.id !== 'number') continue;
    if (checked) panelState.selected.add(a.id);
    else panelState.selected.delete(a.id);
  }
  hooks.persistSelection();
  renderPagesPage();
  updateSelSummary();
}

export function rebuildPages(): void {
  const built = panelState.cache
    ? buildPages(
        panelState.cache.actions,
        panelState.cache.requests,
        panelState.cache.pinia,
        panelState.cache.logs,
        panelState.cache.notes || []
      )
    : [];
  panelState.pages = filterVisiblePages(sortPages(built, panelState.pageSort), panelState.listOrigin, panelState.captureView);
}

export function setPage(idx: number): void {
  const total = Math.max(1, Math.ceil(panelState.pages.length / PAGE_SIZE));
  panelState.pageIdx = Math.min(Math.max(0, idx), total - 1);
  renderPagesPage();
  $('pgInfo').textContent = `${panelState.pageIdx + 1} / ${total}`;
  ($('pgPrev') as HTMLButtonElement).disabled = panelState.pageIdx === 0;
  ($('pgNext') as HTMLButtonElement).disabled = panelState.pageIdx >= total - 1;
}

export function locate(ts: number): void {
  const p = panelState.pages.find((x) => ts >= x.startTime && ts <= x.endTime);
  if (!p) return;
  panelState.highlightKey = p.key;
  setPage(Math.floor(panelState.pages.indexOf(p) / PAGE_SIZE));
  const rows = [...$('pages').children] as PageRow[];
  const row = rows.find((el) => el.__pageKey === p.key);
  if (row && row.__locate) row.__locate();
}

export function submitRangeUi(): void {
  hooks.submitRange();
}
