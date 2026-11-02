// DevTools「Bug Recorder」面板:会话列表(切换/删除)、时间轴缩略图、大步骤勾选
//(与提交页经 storage.session 实时同步)、选范围提交。

import { send } from '../manager/api';
import { $ } from '../manager/dom';
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
import type { SessionSummary, StateInfo, SubmitRange } from '../shared/types';

function init(): void {
  $('btnToggle').addEventListener('click', () => {
    void (async () => {
      const st = await send({ type: 'GET_STATE' });
      await send({ type: st.recording ? 'STOP_RECORDING' : 'START_RECORDING' });
      panelState.sessionId = null; // 回到录制中的会话
      await refreshState();
    })();
  });
  $('btnOpenMgr').addEventListener('click', openManager);
  $('rangeMode').addEventListener('change', () => {
    panelState.rangeMode = ($('rangeMode') as HTMLInputElement).checked;
    clearRange();
  });
  $('btnClearRange').addEventListener('click', clearRange);
  $('btnSubmitRange').addEventListener('click', submitRangeUi);
  $('pgPrev').addEventListener('click', () => setPage(panelState.pageIdx - 1));
  $('pgNext').addEventListener('click', () => setPage(panelState.pageIdx + 1));
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
  $('recText').textContent = st.recording ? '录制中' : '未录制';
  ($('btnToggle') as HTMLButtonElement).textContent = st.recording ? '■ 停止录制' : '● 开始录制';

  panelState.sessions = (await send({ type: 'LIST_SESSIONS' })) as SessionSummary[];
  renderSessions($('sessionList'), panelState.sessions, {
    currentId: panelState.sessionId,
    activeId: panelState.activeId,
    onSelect: (id) => {
      panelState.sessionId = id;
      panelState.highlightKey = null;
      void refreshState();
    },
    onDelete: (id) => void deleteSession(id),
  });

  panelState.cache = panelState.sessionId ? await send({ type: 'GET_SESSION', id: panelState.sessionId }) : null;
  await loadSelection();
  rebuildPages();
  renderTimeline();
  setPage(0);
  updateSelSummary();
  (window as unknown as Record<string, unknown>).__bugrecPanelState = panelState; // 测试钩子
}

async function deleteSession(id: string): Promise<void> {
  if (!confirm('删除该会话及其所有截图/记录?')) return;
  await send({ type: 'DELETE_SESSION', id });
  if (panelState.sessionId === id) panelState.sessionId = null;
  await refreshState();
}

async function loadSelection(): Promise<void> {
  const acts = panelState.cache?.actions ?? [];
  if (!panelState.sessionId) {
    panelState.selected = new Set(acts.map((a) => a.id!));
    return;
  }
  const res = await send({ type: 'GET_SELECTION', sessionId: panelState.sessionId });
  panelState.selected = new Set(res.ids ?? acts.map((a) => a.id!));
}

async function persistSelection(): Promise<void> {
  if (!panelState.sessionId) return;
  const ids = [...panelState.selected];
  const write = async (): Promise<void> => {
    await send({ type: 'SET_SELECTION', sessionId: panelState.sessionId!, ids });
  };
  // 写后读回校验;SW 冷启动等瞬窗失败时重试一次
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await write();
      const back = await send({ type: 'GET_SELECTION', sessionId: panelState.sessionId });
      if (back.ids && back.ids.length === ids.length) return;
    } catch {
      /* 重试 */
    }
    await new Promise((r) => setTimeout(r, 350));
  }
}

async function submitRange(): Promise<void> {
  if (!panelState.range) {
    $('rangeInfo').textContent = '请先点击起点与终点两张截图';
    return;
  }
  if (!panelState.sessionId) {
    $('rangeInfo').textContent = '会话未就绪(尚未开始录制?),无法设置范围';
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
    if (!written) throw new Error('写入后读回为空');
    $('rangeInfo').textContent = `选区已保存,已打开提交页`;
    openManager();
  } catch (e) {
    $('rangeInfo').textContent = '设置选区失败: ' + ((e as { message?: string }).message ?? e);
  }
}

// 供缩略图点击入口(视图中转)
void onThumbClick;
void locate;

init();
