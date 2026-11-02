// 步骤区编排:统一时间线的页面分组渲染、排序/搜索/折叠、勾选与删除。

import { send } from './api.js';
import { $, showError } from './dom.js';
import { store } from './store.js';
import { buildPages, sortPages, filterPages, computePropsDiffs, assignShotNames, buildTabLabels } from '../shared/timeline.js';
import { buildPageGroup } from './page-ui.js';
import { regenerateDescription } from './report-ui.js';

let notifier = null; // 数据变化后刷新会话列表等
export function setNotifier(fn) {
  notifier = fn;
}

export function selectedActions() {
  if (!store.cache) return [];
  return store.cache.actions.filter((a) => store.selected.has(a.id));
}

function buildPagesFiltered() {
  return sortPages(
    filterPages(buildPages(store.cache.actions, store.cache.requests, store.cache.pinia), store.search),
    store.sortMode
  );
}

export function renderAll() {
  const box = $('steps');
  box.textContent = '';
  if (!store.cache) return;
  const ctx = {
    propsDiffs: computePropsDiffs(store.cache.actions),
    shots: assignShotNames(store.cache.actions),
    tabMap: buildTabLabels(store.cache.actions),
    multiTab: buildTabLabels(store.cache.actions).size > 1,
  };
  const handlers = {
    isCollapsed: (p) => store.collapsed.has(p.key),
    isSelected: (a) => store.selected.has(a.id),
    onToggleCollapse: (p) => {
      store.collapsed.has(p.key) ? store.collapsed.delete(p.key) : store.collapsed.add(p.key);
      renderAll();
    },
    onTogglePage: (p, checked) => {
      for (const a of p.actions) checked ? store.selected.add(a.id) : store.selected.delete(a.id);
      renderAll();
      onSelectionChanged();
    },
    onToggleAction: (id, checked) => {
      checked ? store.selected.add(id) : store.selected.delete(id);
      onSelectionChanged();
    },
    onDeleteAction: (a) => deleteAction(a),
    onDeletePage: (p) => deletePage(p),
    onZoom: (src) => {
      $('lightboxImg').src = src;
      $('lightbox').hidden = false;
    },
  };
  for (const p of buildPagesFiltered()) {
    box.appendChild(buildPageGroup(p, ctx, handlers));
  }
  syncSelAll();
}

function onSelectionChanged() {
  syncSelAll();
  updateSelInfo();
  if (!store.descDirty) regenerateDescription();
}

function syncSelAll() {
  $('selAll').checked = !!(store.cache && store.selected.size === store.cache.actions.length);
}

function updateSelInfo() {
  $('selInfo').textContent = store.cache
    ? `已选 ${store.selected.size} / ${store.cache.actions.length} 步(未选步骤不会进入描述与截图附件)`
    : '';
}

/* ---------- 删除 ---------- */

async function deleteAction(a) {
  if (!confirm('删除该步骤?(仅影响当前会话记录)')) return;
  try {
    await send({ type: 'DELETE_ITEMS', sessionId: store.currentId, actionIds: [a.id] });
    store.cache.actions = store.cache.actions.filter((x) => x.id !== a.id);
    store.selected.delete(a.id);
    renderAll();
    onSelectionChanged();
    if (notifier) notifier();
  } catch (e) {
    showError(e);
  }
}

async function deletePage(p) {
  if (!confirm(`删除「${p.url}」整页记录?(含该页 ${p.entries.length} 条步骤/请求/事件)`)) return;
  try {
    const reqEntries = p.entries.filter((e) => e.type === 'request');
    const pinEntries = p.entries.filter((e) => e.type === 'pinia');
    await send({
      type: 'DELETE_ITEMS',
      sessionId: store.currentId,
      actionIds: p.actions.map((a) => a.id),
      requestIds: reqEntries.map((e) => e.data.id),
      piniaIds: pinEntries.map((e) => e.data.id),
    });
    const delIds = new Set(p.actions.map((a) => a.id));
    store.cache.actions = store.cache.actions.filter((x) => !delIds.has(x.id));
    store.cache.requests = store.cache.requests.filter((x) => !reqEntries.some((e) => e.data.id === x.id));
    store.cache.pinia = store.cache.pinia.filter((x) => !pinEntries.some((e) => e.data.id === x.id));
    for (const id of delIds) store.selected.delete(id);
    renderAll();
    onSelectionChanged();
    if (notifier) notifier();
  } catch (e) {
    showError(e);
  }
}

/* ---------- 工具条 ---------- */

export function initToolbar() {
  $('selAll').addEventListener('change', () => {
    if (!store.cache) return;
    store.selected = new Set($('selAll').checked ? store.cache.actions.map((a) => a.id) : []);
    renderAll();
    onSelectionChanged();
  });
  $('searchBox').addEventListener('input', () => {
    store.search = $('searchBox').value;
    renderAll();
  });
  $('sortMode').addEventListener('change', () => {
    store.sortMode = $('sortMode').value;
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
