// 管理页入口:初始化各 UI 模块、录制状态切换、实时刷新。

import { send } from './api';
import { $, showError, showVersion } from './dom';
import { store } from './store';
import { loadSettings, loadTrackersAndPriorities } from './settings-ui';
import { initReport, regenerateDescription } from './report-ui';
import { initToolbar, renderAll, setNotifier } from './steps-ui';
import { refreshSessions, selectSession } from './sessions-ui';
import { selectionStable } from './selection';
import { bindCaptureToggles } from './capture-ui';
import { bootI18n, t } from '../shared/i18n';
import { isIssueProvider, providerLabel } from '../shared/tracker';

bootI18n();

async function refreshRecState(): Promise<{ recording: boolean; sessionId: string | null }> {
  const st = await send({ type: 'GET_STATE' });
  $('dot').classList.toggle('on', st.recording);
  $('recText').textContent = st.recording ? t('stateRecording') : t('stateIdle');
  ($('btnToggleRec') as HTMLButtonElement).textContent = st.recording ? t('btnStop') : t('btnStart');
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
$('btnOptions').addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});
$('btnImport').addEventListener('click', () => ($('fileImport') as HTMLInputElement).click());
$('fileImport').addEventListener('change', () => {
  const input = $('fileImport') as HTMLInputElement;
  const file = input.files && input.files[0];
  input.value = '';
  if (file) void importSessionFile(file);
});
$('lightbox').addEventListener('click', () => ($('lightbox').hidden = true));

chrome.runtime.onMessage.addListener((msg: { type?: string; sessionId?: string | null }) => {
  if (msg && msg.type === 'SESSION_UPDATED') {
    void refreshSessions();
    // 正在查看的会话有新内容:静默刷新;已有勾选存档时尊重用户勾选(不整体重置)
    if (msg.sessionId === store.currentId && store.currentId) {
      const rev = store.selectionRev;
      const sid = store.currentId;
      send({ type: 'GET_SESSION', id: sid })
        .then(async (data) => {
          if (sid !== store.currentId) return;
          const stable = await selectionStable(rev);
          if (sid !== store.currentId) return;
          store.cache = data;
          if (!stable) {
            renderAll();
            return;
          }
          const persisted = await send({ type: 'GET_SELECTION', sessionId: sid }).catch(() => null);
          if (rev !== store.selectionRev) {
            renderAll();
            return;
          }
          if (persisted && persisted.ids) {
            store.selected = new Set(persisted.ids.filter((id) => typeof id === 'number'));
          } else {
            for (const a of data.actions) {
              if (typeof a.id === 'number') store.selected.add(a.id);
            }
          }
          renderAll();
          if (!store.descDirty) regenerateDescription();
        })
        .catch(() => {});
    }
  }
});

function paintTracker(): void {
  const name = isIssueProvider(store.settings.provider) ? store.settings.provider : 'redmine';
  const hint = $('trackerHint');
  const isRedmine = name === 'redmine';
  hint.classList.toggle('err', !isRedmine);
  hint.textContent = isRedmine ? t('trackerNow', providerLabel(name)) : t('submitOnlyRedmine', providerLabel(name));
  ($('btnSubmit') as HTMLButtonElement).disabled = !isRedmine;
}

async function importSessionFile(file: File): Promise<void> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    if (e instanceof SyntaxError) {
      showError(new Error(t('importBad')));
      return;
    }
    throw e;
  }
  try {
    const res = await send({ type: 'IMPORT_SESSION', data });
    await refreshSessions();
    await selectSession(res.id);
    $('err').textContent = t('importOk');
    $('err').hidden = false;
  } catch (e) {
    showError(e);
  }
}

(async function init(): Promise<void> {
  try {
    showVersion();
    bindCaptureToggles($('captureBar'));
    await loadSettings();
    paintTracker();
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
