// 步骤区编排:统一时间线的页面分组渲染、排序/搜索/折叠、勾选与删除。

import { send } from './api';
import { $, showError } from './dom';
import { store } from './store';
import {
  buildPages,
  sortPages,
  filterPages,
  filterVisiblePages,
  computePropsDiffs,
  buildTabLabels,
  type CaptureView,
} from '../shared/timeline';
import { planShotUploads } from '../shared/shots';
import { t } from '../shared/i18n';
import { buildPageGroup } from './page-ui';
import { regenerateDescription } from './report-ui';
import { persistSelection, adoptSelection, selectionKey } from './selection';
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
  return filterVisiblePages(
    sortPages(
      filterPages(
        buildPages(store.cache.actions, store.cache.requests, store.cache.pinia, store.cache.logs, store.cache.notes || []),
        store.search
      ),
      store.sortMode
    ),
    store.listOrigin,
    store.captureView
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
    listOrigin: store.listOrigin,
    captureView: store.captureView,
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
        if (typeof a.id !== 'number') continue;
        if (checked) store.selected.add(a.id);
        else store.selected.delete(a.id);
      }
      renderAll();
      onSelectionChanged();
    },
    onToggleAction: (id: number, checked: boolean) => {
      if (typeof id !== 'number') return;
      if (checked) store.selected.add(id);
      else store.selected.delete(id);
      renderAll();
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
  const pages = buildPagesFiltered();
  if (!pages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = t('filterEmpty');
    box.appendChild(empty);
  }
  for (const p of pages) {
    box.appendChild(buildPageGroup(p, ctx, handlers));
  }
  syncSelAll();
}

function onSelectionChanged(): void {
  syncSelAll();
  updateSelInfo();
  void persistSelection();
  if (!store.descDirty) regenerateDescription();
}

function syncSelAll(): void {
  ($('selAll') as HTMLInputElement).checked = !!(store.cache && store.selected.size === store.cache.actions.length);
}

function updateSelInfo(): void {
  const text = store.cache ? t('selInfo', [String(store.selected.size), String(store.cache.actions.length)]) : '';
  $('selInfo').textContent = text;
  const dock = document.getElementById('dockSel');
  if (dock) dock.textContent = store.cache ? t('selDock', String(store.selected.size)) : '';
}

/* ---------- 删除 ---------- */

async function deleteAction(a: RecordedAction): Promise<void> {
  if (!confirm(t('confirmDeleteStep'))) return;
  try {
    await send({ type: 'DELETE_ITEMS', sessionId: store.currentId, actionIds: [a.id!] });
    if (store.cache) store.cache.actions = store.cache.actions.filter((x) => x.id !== a.id);
    store.selected.delete(a.id!);
    await persistSelection();
    renderAll();
    onSelectionChanged();
    if (notifier) notifier();
  } catch (e) {
    showError(e);
  }
}

async function deletePage(p: PageGroup): Promise<void> {
  if (!confirm(t('confirmDeletePage', [p.url, String(p.entries.length)]))) return;
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
    await persistSelection();
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
    store.selected = new Set(
      ($('selAll') as HTMLInputElement).checked
        ? store.cache.actions.map((a) => a.id).filter((id): id is number => typeof id === 'number')
        : []
    );
    renderAll();
    onSelectionChanged();
  });
  $('searchBox').addEventListener('input', () => {
    store.search = ($('searchBox') as HTMLInputElement).value;
    renderAll();
  });
  $('listOrigin').addEventListener('change', () => {
    store.listOrigin = ($('listOrigin') as HTMLSelectElement).value as 'all' | 'human' | 'event';
    renderAll();
  });
  $('viewFilters').addEventListener('change', (ev) => {
    const input = ev.target;
    if (!(input instanceof HTMLInputElement) || !input.dataset.view) return;
    const key = input.dataset.view as keyof CaptureView;
    store.captureView = { ...store.captureView, [key]: input.checked };
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
  // DevTools 面板的勾选变化 → 本页实时采纳(storage 双向同步)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (!store.currentId) return;
    const key = selectionKey(store.currentId);
    if (!(key in changes) || areaName !== 'session') return;
    if (adoptSelection(changes[key]!.newValue)) {
      syncSelAll();
      updateSelInfo();
      renderAll();
      if (!store.descDirty) regenerateDescription();
    }
  });
}
