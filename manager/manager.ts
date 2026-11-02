// 管理页入口:初始化各 UI 模块、录制状态切换、实时刷新。

import { send } from './api';
import { $, showError } from './dom';
import { store } from './store';
import { initSettings, loadSettings, loadTrackersAndPriorities } from './settings-ui';
import { initReport, regenerateDescription } from './report-ui';
import { initToolbar, renderAll, setNotifier } from './steps-ui';
import { refreshSessions, selectSession } from './sessions-ui';

async function refreshRecState(): Promise<{ recording: boolean; sessionId: string | null }> {
  const st = await send({ type: 'GET_STATE' });
  $('dot').classList.toggle('on', st.recording);
  $('recText').textContent = st.recording ? '录制中' : '未录制';
  ($('btnToggleRec') as HTMLButtonElement).textContent = st.recording ? '■ 停止录制' : '● 开始录制';
  return st;
}

$('btnToggleRec').addEventListener('click', () => {
  void (async () => {
    try {
      const st = await send({ type: 'GET_STATE' });
      const res = await send({ type: st.recording ? 'STOP_RECORDING' : 'START_RECORDING' });
      await refreshRecState();
      await refreshSessions();
      void selectSession(st.recording ? st.sessionId! : (res as { sessionId?: string }).sessionId!);
    } catch (e) {
      showError(e);
    }
  })();
});

$('btnRefresh').addEventListener('click', () => void refreshSessions());
$('lightbox').addEventListener('click', () => ($('lightbox').hidden = true));

chrome.runtime.onMessage.addListener((msg: { type?: string; sessionId?: string | null }) => {
  if (msg && msg.type === 'SESSION_UPDATED') {
    void refreshSessions();
    // 正在查看的会话有新内容:静默刷新,新步骤默认勾选,不打扰正在填写的表单
    if (msg.sessionId === store.currentId && store.currentId) {
      send({ type: 'GET_SESSION', id: store.currentId })
        .then((data) => {
          store.cache = data;
          for (const a of data.actions) store.selected.add(a.id!);
          renderAll();
          if (!store.descDirty) regenerateDescription();
        })
        .catch(() => {});
    }
  }
});

(async function init(): Promise<void> {
  try {
    await loadSettings();
    initSettings();
    initReport();
    initToolbar();
    void loadTrackersAndPriorities();
    setNotifier(() => void refreshSessions());
    const st = await refreshRecState();
    await refreshSessions();
    if (st.recording && st.sessionId) {
      await selectSession(st.sessionId);
    } else if (store.sessions.length) {
      await selectSession(store.sessions[0]!.id);
    }
    (window as unknown as Record<string, unknown>).__bugrecMgrReady = true; // 供自动化测试等待初始化完成
  } catch (e) {
    (window as unknown as Record<string, unknown>).__bugrecMgrErr = String((e as { message?: string }).message ?? e);
    showError(e);
  }
})();
