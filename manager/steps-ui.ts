// 步骤区编排:统一时间线的页面分组渲染、排序/搜索/折叠、勾选与删除。

import { send } from './api';
import { $, showError } from './dom';
import { store } from './store';
import {
  buildPages,
  sortPages,
  filterPages,
  computePropsDiffs,
  buildTabLabels,
} from '../shared/timeline';
import { planShotUploads } from '../shared/shots';
import { buildPageGroup } from './page-ui';
import { regenerateDescription } from './report-ui';
import type { RecordedAction, PageGroup, PiniaEvent, RequestEntry } from '../shared/types';

let notifier: (() => void) | null = null; // 数据变化后刷新会话列表等
export function setNotifier(fn: () => void): void {
  notifier = fn;
}

export function selectedActions(): RecordedAction[] {
  if (!store.cache) return [];
  return store.cache.actions.filter((a) => store.selected.has(a.id!));
}

function buildPagesFiltered(): PageGroup[] {
  if (!store.cache) return [];
  return sortPages(
    filterPages(buildPages(store.cache.actions, store.cache.requests, store.cache.pinia), store.search),
    store.sortMode
  );
}

export function renderAll(): void {
  const box = $('steps');
  box.textContent = '';
  if (!store.cache) return;
  const ctx = {
    propsDiffs: computePropsDiffs(store.cache.actions),
    shots: new Map(planShotUploads(store.cache.actions).map((p) => [p.actionId, p.filename])),
    tabMap: buildTabLabels(store.cache.actions),
    multiTab: buildTabLabels(store.cache.actions).size > 1,
  };
  const handlers = {
    isCollapsed: (p: PageGroup) => store.collapsed.has(p.key),
    isSelected: (a: RecordedAction) => store.selected.has(a.id!),
    onToggleCollapse: (p: PageGroup) => {
      if (store.collapsed.has(p.key)) store.collapsed.delete(p.key);
      else store.collapsed.add(p.key);
      renderAll();
    },
    onTogglePage: (p: PageGroup, checked: boolean) => {
      for (const a of p.actions) {
        if (checked) store.selected.add(a.id!);
        else store.selected.delete(a.id!);
      }
      renderAll();
      onSelectionChanged();
    },
    onToggleAction: (id: number, checked: boolean) => {
      if (checked) store.selected.add(id);
      else store.selected.delete(id);
      onSelectionChanged();
    },
    onDeleteAction: (a: RecordedAction) => void deleteAction(a),
    onDeletePage: (p: PageGroup) => void deletePage(p),
    onZoom: (a: RecordedAction) => {
      $('lightboxImg').setAttribute('src', a.screenshot || '');
      const m = $('lightboxMarker');
      if (a.point && a.viewport) {
        m.style.left = (a.point.x / a.viewport.w) * 100 + '%';
        m.style.top = (a.point.y / a.viewport.h) * 100 + '%';
        m.hidden = false;
      } else {
        m.hidden = true;
      }
      $('lightbox').hidden = false;
    },
  };
  for (const p of buildPagesFiltered()) {
    box.appendChild(buildPageGroup(p, ctx, handlers));
  }
  syncSelAll();
}

function onSelectionChanged(): void {
  syncSelAll();
  updateSelInfo();
  if (!store.descDirty) regenerateDescription();
}

function syncSelAll(): void {
  ($('selAll') as HTMLInputElement).checked = !!(store.cache && store.selected.size === store.cache.actions.length);
}

function updateSelInfo(): void {
  $('selInfo').textContent = store.cache
    ? `已选 ${store.selected.size} / ${store.cache.actions.length} 步(未选步骤不会进入描述与截图附件)`
    : '';
}

/* ---------- 删除 ---------- */

async function deleteAction(a: RecordedAction): Promise<void> {
  if (!confirm('删除该步骤?(仅影响当前会话记录)')) return;
  try {
    await send({ type: 'DELETE_ITEMS', sessionId: store.currentId, actionIds: [a.id!] });
    if (store.cache) store.cache.actions = store.cache.actions.filter((x) => x.id !== a.id);
    store.selected.delete(a.id!);
    renderAll();
    onSelectionChanged();
    if (notifier) notifier();
  } catch (e) {
    showError(e);
  }
}

async function deletePage(p: PageGroup): Promise<void> {
  if (!confirm(`删除「${p.url}」整页记录?(含该页 ${p.entries.length} 条步骤/请求/事件)`)) return;
  try {
    const reqEntries = p.entries.filter((e) => e.type === 'request') as { data: RequestEntry }[];
    const pinEntries = p.entries.filter((e) => e.type === 'pinia') as { data: PiniaEvent }[];
    await send({
      type: 'DELETE_ITEMS',
      sessionId: store.currentId,
      actionIds: p.actions.map((a) => a.id!),
      requestIds: reqEntries.map((e) => e.data.id!),
      piniaIds: pinEntries.map((e) => e.data.id!),
    });
    if (store.cache) {
      const delIds = new Set(p.actions.map((a) => a.id));
      store.cache.actions = store.cache.actions.filter((x) => !delIds.has(x.id));
      store.cache.requests = store.cache.requests.filter((x) => !reqEntries.some((e) => e.data.id === x.id));
      store.cache.pinia = store.cache.pinia.filter((x) => !pinEntries.some((e) => e.data.id === x.id));
    }
    for (const a of p.actions) store.selected.delete(a.id!);
    renderAll();
    onSelectionChanged();
    if (notifier) notifier();
  } catch (e) {
    showError(e);
  }
}

/* ---------- 工具条 ---------- */

export function initToolbar(): void {
  $('selAll').addEventListener('change', () => {
    if (!store.cache) return;
    store.selected = new Set(($('selAll') as HTMLInputElement).checked ? store.cache.actions.map((a) => a.id!) : []);
    renderAll();
    onSelectionChanged();
  });
  $('searchBox').addEventListener('input', () => {
    store.search = ($('searchBox') as HTMLInputElement).value;
    renderAll();
  });
  $('sortMode').addEventListener('change', () => {
    store.sortMode = ($('sortMode') as HTMLSelectElement).value as 'asc' | 'desc';
    renderAll();
  });
  $('btnCollapseAll').addEventListener('click', () => {
    if (!store.cache) return;
    const pages = buildPagesFiltered();
    const allCollapsed = pages.every((p) => store.collapsed.has(p.key));
    if (allCollapsed) store.collapsed.clear();
    else for (const p of pages) store.collapsed.add(p.key);
    renderAll();
  });
}
