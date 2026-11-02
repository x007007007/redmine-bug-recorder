// 管理页入口:初始化各 UI 模块、录制状态切换、实时刷新。

import { send } from './api.js';
import { $, showError } from './dom.js';
import { store } from './store.js';
import { init as initSettings, loadSettings, loadTrackersAndPriorities } from './settings-ui.js';
import { init as initReport, regenerateDescription } from './report-ui.js';
import { initToolbar, renderAll, setNotifier } from './steps-ui.js';
import { refreshSessions, selectSession } from './sessions-ui.js';

async function refreshRecState() {
  const st = await send({ type: 'GET_STATE' });
  $('dot').classList.toggle('on', st.recording);
  $('recText').textContent = st.recording ? '录制中' : '未录制';
  $('btnToggleRec').textContent = st.recording ? '■ 停止录制' : '● 开始录制';
  return st;
}

$('btnToggleRec').addEventListener('click', async () => {
  try {
    const st = await send({ type: 'GET_STATE' });
    const res = await send({ type: st.recording ? 'STOP_RECORDING' : 'START_RECORDING' });
    await refreshRecState();
    await refreshSessions();
    selectSession(st.recording ? st.sessionId : res.sessionId);
  } catch (e) {
    showError(e);
  }
});

$('btnRefresh').addEventListener('click', refreshSessions);
$('lightbox').addEventListener('click', () => ($('lightbox').hidden = true));

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'SESSION_UPDATED') {
    refreshSessions();
    // 正在查看的会话有新内容:静默刷新,新步骤默认勾选,不打扰正在填写的表单
    if (msg.sessionId === store.currentId) {
      send({ type: 'GET_SESSION', id: store.currentId })
        .then((data) => {
          store.cache = data;
          for (const a of data.actions) store.selected.add(a.id);
          renderAll();
          if (!store.descDirty) regenerateDescription();
        })
        .catch(() => {});
    }
  }
});

(async function init() {
  try {
    await loadSettings();
    initSettings();
    initReport();
    initToolbar();
    loadTrackersAndPriorities();
    setNotifier(refreshSessions);
    await refreshRecState();
    await refreshSessions();
    const st = await send({ type: 'GET_STATE' });
    if (st.recording && st.sessionId) {
      selectSession(st.sessionId);
    } else if (store.sessions.length) {
      selectSession(store.sessions[0].id);
    }
    window.__bugrecMgrReady = true; // 供自动化测试等待初始化完成
  } catch (e) {
    window.__bugrecMgrErr = String((e && e.message) || e);
    showError(e);
  }
})();
