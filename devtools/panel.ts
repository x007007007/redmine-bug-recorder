// DevTools「Bug Recorder」面板:会话列表(切换/删除)、时间轴缩略图、大步骤勾选
//(与提交页经 storage.session 实时同步)、选范围提交。

import { send } from '../manager/api';
import { bindCaptureToggles } from '../manager/capture-ui';
import { $, showVersion } from '../manager/dom';
import { renderSessions } from './panel-sessions';
import { panelState } from './panel-state';
import {
  bindView,
  clearRange,
  locate,
  onThumbClick,
  rebuildPages,
  renderPagesPage,
  renderTimeline,
  setPage,
  submitRangeUi,
  updateSelSummary,
} from './panel-view';
import type { CaptureView } from '../shared/timeline';
import { bootI18n, t } from '../shared/i18n';
import type { SessionSummary, StateInfo, SubmitRange } from '../shared/types';

bootI18n();

function init(): void {
  showVersion();
  $('btnToggle').addEventListener('click', () => {
    void (async () => {
      const st = await send({ type: 'GET_STATE' });
      await send({ type: st.recording ? 'STOP_RECORDING' : 'START_RECORDING' });
      panelState.sessionId = null; // 回到录制中的会话
      await refreshState();
    })();
  });
  $('btnOpenMgr').addEventListener('click', openManager);
  $('btnOptions').addEventListener('click', () => void chrome.runtime.openOptionsPage());
  $('rangeMode').addEventListener('change', () => {
    panelState.rangeMode = ($('rangeMode') as HTMLInputElement).checked;
    clearRange();
  });
  $('btnClearRange').addEventListener('click', clearRange);
  $('btnSubmitRange').addEventListener('click', submitRangeUi);
  $('pgPrev').addEventListener('click', () => setPage(panelState.pageIdx - 1));
  $('pgNext').addEventListener('click', () => setPage(panelState.pageIdx + 1));
  $('listOrigin').addEventListener('change', () => {
    panelState.listOrigin = ($('listOrigin') as HTMLSelectElement).value as 'all' | 'human' | 'event';
    rebuildPages();
    setPage(0);
  });
  $('viewFilters').addEventListener('change', (ev) => {
    const input = ev.target;
    if (!(input instanceof HTMLInputElement) || !input.dataset.view) return;
    const key = input.dataset.view as keyof CaptureView;
    panelState.captureView = { ...panelState.captureView, [key]: input.checked };
    rebuildPages();
    setPage(0);
  });
  $('pageSort').addEventListener('change', () => {
    panelState.pageSort = ($('pageSort') as HTMLSelectElement).value as 'asc' | 'desc';
    rebuildPages();
    setPage(0);
  });
  bindCaptureToggles($('captureBar'));
  chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
    if (msg && msg.type === 'SESSION_UPDATED') void refreshState();
  });
  // 提交页(或其它入口)改了勾选 → 这里实时采纳
  chrome.storage.onChanged.addListener((changes, areaName) => {
    const sid = panelState.sessionId;
    if (!sid || areaName !== 'session') return;
    const ids = changes[`selection:${sid}`]?.newValue as number[] | undefined;
    if (!Array.isArray(ids)) return;
    const next = new Set(ids);
    const same = next.size === panelState.selected.size && [...next].every((id) => panelState.selected.has(id));
    if (!same) {
      panelState.selected = next;
      renderPagesPage();
      updateSelSummary();
    }
  });
  bindView({ persistSelection: () => void persistSelection(), submitRange: () => void submitRange() });
  void refreshState();
}

function openManager(): void {
  const url = chrome.runtime.getURL('manager/manager.html');
  try {
    void chrome.tabs.create({ url });
  } catch {
    window.open(url, '_blank');
  }
}

async function refreshState(): Promise<void> {
  const st: StateInfo = await send({ type: 'GET_STATE' });
  panelState.recording = st.recording;
  panelState.activeId = st.sessionId;
  if (!panelState.sessionId) panelState.sessionId = st.sessionId;
  $('dot').classList.toggle('on', st.recording);
  $('recText').textContent = st.recording ? t('stateRecording') : t('stateIdle');
  ($('btnToggle') as HTMLButtonElement).textContent = st.recording ? t('btnStop') : t('btnStart');

  panelState.sessions = (await send({ type: 'LIST_SESSIONS' })) as SessionSummary[];
  const listed = new Set(panelState.sessions.map((s) => s.id));
  if (!panelState.sessionId || !listed.has(panelState.sessionId)) {
    panelState.sessionId = st.sessionId && listed.has(st.sessionId) ? st.sessionId : (panelState.sessions[0]?.id ?? null);
  }
  $('sessCount').textContent = panelState.sessions.length ? t('countItems', String(panelState.sessions.length)) : t('noneShort');
  paintSessions();

  panelState.cache = panelState.sessionId ? await send({ type: 'GET_SESSION', id: panelState.sessionId }) : null;
  await loadSelection();
  rebuildPages();
  renderTimeline();
  setPage(0);
  updateSelSummary();
  (window as unknown as Record<string, unknown>).__bugrecPanelState = panelState; // 测试钩子
}

function paintSessions(): void {
  if (panelState.pendingDeleteId && !panelState.sessions.some((s) => s.id === panelState.pendingDeleteId)) {
    panelState.pendingDeleteId = null;
  }
  renderSessions($('sessionList'), panelState.sessions, {
    currentId: panelState.sessionId,
    activeId: panelState.activeId,
    pendingDeleteId: panelState.pendingDeleteId,
    onSelect: (id) => {
      panelState.sessionId = id;
      panelState.highlightKey = null;
      panelState.pendingDeleteId = null;
      void refreshState();
    },
    onAskDelete: (id) => {
      panelState.pendingDeleteId = id;
      paintSessions();
    },
    onCancelDelete: () => {
      panelState.pendingDeleteId = null;
      paintSessions();
    },
    onDelete: (id) => void deleteSession(id),
  });
}

async function deleteSession(id: string): Promise<void> {
  panelState.pendingDeleteId = null;
  try {
    if (panelState.recording && panelState.activeId === id) await send({ type: 'STOP_RECORDING' });
    await send({ type: 'DELETE_SESSION', id });
    if (panelState.sessionId === id) panelState.sessionId = null;
    $('sessHint').textContent = t('deleted');
    await refreshState();
  } catch (e) {
    $('sessHint').textContent = t('deleteFailed', String((e as { message?: string }).message ?? e));
    paintSessions();
  }
}

let selectionGate: Promise<void> = Promise.resolve();

async function loadSelection(): Promise<void> {
  const rev = panelState.selectionRev;
  const acts = panelState.cache?.actions ?? [];
  const fallback = acts.map((a) => a.id).filter((id): id is number => typeof id === 'number');
  if (!panelState.sessionId) {
    panelState.selected = new Set(fallback);
    return;
  }
  await selectionGate;
  if (rev !== panelState.selectionRev || !panelState.sessionId) return;
  const res = await send({ type: 'GET_SELECTION', sessionId: panelState.sessionId });
  if (rev !== panelState.selectionRev) return;
  const ids = res.ids ? res.ids.filter((id) => typeof id === 'number') : fallback;
  panelState.selected = new Set(ids);
}

async function persistSelection(): Promise<void> {
  if (!panelState.sessionId) return;
  panelState.selectionRev += 1;
  const rev = panelState.selectionRev;
  const sessionId = panelState.sessionId;
  const ids = [...panelState.selected].filter((id) => typeof id === 'number');
  const job = selectionGate.then(() => writeSelection(rev, sessionId, ids));
  selectionGate = job.then(
    () => undefined,
    () => undefined
  );
  await job;
}

async function writeSelection(rev: number, sessionId: string, ids: number[]): Promise<void> {
  if (rev !== panelState.selectionRev) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (rev !== panelState.selectionRev) return;
    try {
      await send({ type: 'SET_SELECTION', sessionId, ids });
      const back = await send({ type: 'GET_SELECTION', sessionId });
      if (rev !== panelState.selectionRev) return;
      if (back.ids && back.ids.length === ids.length) return;
    } catch {
      /* 重试 */
    }
    await new Promise((r) => setTimeout(r, 350));
  }
}

async function submitRange(): Promise<void> {
  if (!panelState.range) {
    $('rangeInfo').textContent = t('rangeNeedBoth');
    return;
  }
  if (!panelState.sessionId) {
    $('rangeInfo').textContent = t('rangeNoSession');
    return;
  }
  const payload: SubmitRange = {
    sessionId: panelState.sessionId,
    fromTs: panelState.range.fromTs,
    toTs: panelState.range.toTs,
  };
  const areas = [chrome.storage.session, chrome.storage.local].filter(Boolean);
  try {
    let written = false;
    for (const area of areas) {
      try {
        await area.set({ submitRange: payload });
        const back = (await area.get('submitRange')) as { submitRange?: SubmitRange };
        if (back && back.submitRange) {
          written = true;
          break;
        }
      } catch {
        /* 尝试下一个区域 */
      }
    }
    if (!written) throw new Error(t('rangeWriteEmpty'));
    $('rangeInfo').textContent = t('rangeSaved');
    openManager();
  } catch (e) {
    $('rangeInfo').textContent = t('rangeSaveFailed', String((e as { message?: string }).message ?? e));
  }
}

// 供缩略图点击入口(视图中转)
void onThumbClick;
void locate;

init();
