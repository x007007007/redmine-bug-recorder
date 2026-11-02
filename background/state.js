// 共享状态与工具:录制会话状态(SW 休眠可恢复)、设置读取、徽章、通知。

const SETTINGS_KEY = 'recorderSettings';

export const state = { recording: false, sessionId: null };

export const mem = {
  debuggerTabs: new Map(), // tabId -> { reqs: Map<cdpRequestId, entry> }
  webRequestPending: new Map(), // webRequestId -> entry
  captureQueue: Promise.resolve(),
  debuggerFailed: false,
};

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function init() {
  try {
    const stored = await chrome.storage.session.get('state');
    if (stored && stored.state && stored.state.recording && stored.state.sessionId) {
      state.recording = true;
      state.sessionId = stored.state.sessionId;
    }
  } catch {
    /* storage.session 不可用时忽略 */
  }
  updateBadge();
}

export function persistState() {
  try {
    chrome.storage.session.set({ state: { ...state } });
  } catch {
    /* ignore */
  }
}

export function updateBadge() {
  const text = state.recording ? 'REC' : '';
  try {
    chrome.action.setBadgeText({ text });
    if (state.recording) chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  } catch {
    /* ignore */
  }
}

export async function getSettings() {
  const o = await chrome.storage.local.get(SETTINGS_KEY);
  return Object.assign({ captureBodies: true, attachScreenshots: true }, o[SETTINGS_KEY] || {});
}

export function notifySessionUpdated() {
  try {
    const p = chrome.runtime.sendMessage({ type: 'SESSION_UPDATED', sessionId: state.sessionId });
    if (p && p.catch) p.catch(() => {});
  } catch {
    /* popup/manager 未打开时忽略 */
  }
}
