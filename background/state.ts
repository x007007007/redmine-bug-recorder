// 共享状态与工具:录制会话状态(SW 休眠可恢复)、设置读取、徽章、通知。

import { normalizeCapture, type CaptureFlags } from '../shared/capture';
import { normalizeBase } from '../shared/redmine';
import type { RecorderSettings, RequestEntry, StateInfo } from '../shared/types';

const SETTINGS_KEY = 'recorderSettings';

export const state: { recording: boolean; sessionId: string | null } = { recording: false, sessionId: null };

export const mem: {
  debuggerTabs: Map<number, { reqs: Map<string, RequestEntry> }>;
  webRequestPending: Map<string, RequestEntry>;
  captureQueue: Promise<void>;
  debuggerFailed: boolean;
  capture: CaptureFlags;
  activeTabId: number | null;
  redmineBase: string;
} = {
  debuggerTabs: new Map(),
  webRequestPending: new Map(),
  captureQueue: Promise.resolve(),
  debuggerFailed: false,
  capture: normalizeCapture(undefined),
  activeTabId: null,
  redmineBase: '',
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
  await whenCaptureReady();
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
  const settings = Object.assign({ captureBodies: true, attachScreenshots: true }, o[SETTINGS_KEY] || {});
  settings.capture = normalizeCapture(settings.capture);
  return settings;
}

let captureLoaded: Promise<CaptureFlags> | null = null;

export function whenCaptureReady(): Promise<CaptureFlags> {
  if (!captureLoaded) captureLoaded = loadCapture();
  return captureLoaded;
}

async function loadCapture(): Promise<CaptureFlags> {
  const settings = await getSettings();
  mem.capture = normalizeCapture(settings.capture);
  rememberRedmineBase(settings.redmineUrl);
  return mem.capture;
}

export function rememberRedmineBase(url: string | undefined): void {
  mem.redmineBase = normalizeBase(url);
}

export async function saveCapture(patch: Partial<CaptureFlags>): Promise<CaptureFlags> {
  await whenCaptureReady();
  const settings = await getSettings();
  const capture = normalizeCapture({ ...mem.capture, ...patch });
  mem.capture = capture;
  settings.capture = capture;
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return capture;
}

export function currentState(): StateInfo {
  return {
    recording: state.recording,
    sessionId: state.sessionId,
    debuggerFailed: mem.debuggerFailed,
    capture: mem.capture,
  };
}

export function notifySessionUpdated(): void {
  try {
    const p = chrome.runtime.sendMessage({ type: 'SESSION_UPDATED', sessionId: state.sessionId });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    /* popup/manager 未打开时忽略 */
  }
}
