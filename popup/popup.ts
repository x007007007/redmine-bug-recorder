// 弹窗:开始/停止录制、状态与最近会话摘要、入口按钮。

import { send } from '../manager/api';
import { bindCaptureToggles } from '../manager/capture-ui';
import { $, showError, showVersion } from '../manager/dom';
import { fmtTime } from '../shared/describe';
import { bootI18n, t } from '../shared/i18n';

bootI18n();
import type { SessionSummary, StateInfo } from '../shared/types';

function refresh(): void {
  void (async () => {
    try {
      const st: StateInfo = await send({ type: 'GET_STATE' });
      $('dot').classList.toggle('on', st.recording);
      $('stateText').textContent = st.recording ? t('stateRecordingDots') : t('stateIdle');
      const btn = $('btnToggle') as HTMLButtonElement;
      btn.textContent = st.recording ? t('btnStop') : t('btnStart');
      btn.classList.toggle('stop', st.recording);

      const sessions = (await send({ type: 'LIST_SESSIONS' })) as SessionSummary[];
      renderSessionList(sessions, st.sessionId);
      const cur = sessions.find((s) => s.id === st.sessionId) || sessions[0];
      if (cur) {
        const start = new Date(cur.startedAt).toLocaleTimeString(undefined, { hour12: false });
        const which = cur.status === 'recording' ? t('popupCurrent') : t('popupRecent');
        $('stats').textContent = t('popupStats', [which, start, String(cur.actionCount), String(cur.requestCount)]) + (cur.issueUrl ? t('popupSubmitted') : '');
      } else {
        $('stats').textContent = t('popupNone');
      }
      if (st.recording && st.debuggerFailed) {
        showError(new Error(t('popupDebugger')));
      }
    } catch (e) {
      showError(e);
    }
  })();
}

function renderSessionList(sessions: SessionSummary[], activeId: string | null): void {
  const box = $('sessionList');
  box.textContent = '';
  if (!sessions.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = t('sessionsEmptyPopup');
    box.appendChild(empty);
    return;
  }
  for (const s of sessions.slice(0, 8)) {
    const row = document.createElement('div');
    row.className = 'session-item';
    const status = { recording: t('stateRecording'), stopped: t('stateStopped'), submitted: t('stateSubmitted') }[s.status] || s.status;
    const when = document.createElement('b');
    when.textContent = fmtTime(s.startedAt).slice(5);
    const meta = document.createElement('span');
    meta.className = 'm';
    const logs = s.logCount ? t('popupConsole', String(s.logCount)) : '';
    meta.textContent = t('popupMeta', [status, String(s.actionCount), String(s.requestCount), logs]);
    row.append(when, document.createTextNode(' '));
    if (s.id === activeId) {
      const live = document.createElement('span');
      live.className = 'live';
      live.textContent = t('live');
      row.append(live, document.createTextNode(' '));
    }
    row.append(meta);
    row.addEventListener('click', () => {
      void chrome.tabs.create({ url: chrome.runtime.getURL('manager/manager.html') });
      window.close();
    });
    box.appendChild(row);
  }
}

$('btnToggle').addEventListener('click', () => {
  void (async () => {
    try {
      const st = await send({ type: 'GET_STATE' });
      await send({ type: st.recording ? 'STOP_RECORDING' : 'START_RECORDING' });
      refresh();
    } catch (e) {
      showError(e);
    }
  })();
});

$('btnManager').addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('manager/manager.html') });
  window.close();
});

$('btnOptions').addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
  window.close();
});

chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg && msg.type === 'SESSION_UPDATED') refresh();
});

showVersion();
bindCaptureToggles($('captureBar'));
refresh();
