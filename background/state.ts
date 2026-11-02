// 共享状态与工具:录制会话状态(SW 休眠可恢复)、设置读取、徽章、通知。

import type { RecorderSettings, RequestEntry, StateInfo } from '../shared/types';

const SETTINGS_KEY = 'recorderSettings';

export const state: { recording: boolean; sessionId: string | null } = { recording: false, sessionId: null };

export const mem: {
  debuggerTabs: Map<number, { reqs: Map<string, RequestEntry> }>;
  webRequestPending: Map<string, RequestEntry>;
  captureQueue: Promise<void>;
  debuggerFailed: boolean;
} = {
  debuggerTabs: new Map(),
  webRequestPending: new Map(),
  captureQueue: Promise.resolve(),
  debuggerFailed: false,
};

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function initState(): Promise<void> {
  try {
    const stored = (await chrome.storage.session.get('state')) as { state?: StateInfo };
    if (stored && stored.state && stored.state.recording && stored.state.sessionId) {
      state.recording = true;
      state.sessionId = stored.state.sessionId;
    }
  } catch {
    /* storage.session 不可用时忽略 */
  }
  updateBadge();
}

export function persistState(): void {
  try {
    chrome.storage.session.set({ state: { ...state } });
  } catch {
    /* ignore */
  }
}

export function updateBadge(): void {
  const text = state.recording ? 'REC' : '';
  try {
    chrome.action.setBadgeText({ text });
    if (state.recording) chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  } catch {
    /* ignore */
  }
}

export async function getSettings(): Promise<RecorderSettings> {
  const o = (await chrome.storage.local.get(SETTINGS_KEY)) as { recorderSettings?: RecorderSettings };
  return Object.assign({ captureBodies: true, attachScreenshots: true }, o[SETTINGS_KEY] || {});
}

export function notifySessionUpdated(): void {
  try {
    const p = chrome.runtime.sendMessage({ type: 'SESSION_UPDATED', sessionId: state.sessionId });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    /* popup/manager 未打开时忽略 */
  }
}
