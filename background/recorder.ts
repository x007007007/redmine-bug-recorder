// 录制编排:开始/停止、接收操作与 Pinia 事件、导航步骤、截图管线。
// 截图在操作约 380ms 后截取(UI 渲染后);若届时该标签页已不是可见页,宁可不截,避免拍到错误页面。

import { dbAdd, dbGet, dbPut, dbCountByIndex } from '../shared/db';
import { state, mem, sleep, persistState, updateBadge, notifySessionUpdated } from './state';
import { attachDebugger, detachAll } from './net-cdp';
import { t } from '../shared/i18n';
import { pageUrl } from '../shared/timeline';
import type { PiniaEvent, RecordedAction, RecorderSession } from '../shared/types';

const SHOT_DELAY_MS = 380;
const MAX_PINIA_PER_SESSION = 500;
const lastPageByTab = new Map<number, string>();

export function installRecorder(): void {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!state.recording) return;
    if (changeInfo.url && tab && tab.url && /^https?:/.test(tab.url)) {
      void pushNavigate(tab, changeInfo.url, t('navJump'));
    }
  });
}

export async function startRecording(): Promise<{ ok: boolean; sessionId?: string; already?: boolean }> {
  if (state.recording) return { ok: true, sessionId: state.sessionId!, already: true };
  const id = crypto.randomUUID();
  const session: RecorderSession = {
    id,
    startedAt: Date.now(),
    endedAt: null,
    status: 'recording',
    subject: '',
    issueId: null,
    issueUrl: null,
  };
  await dbPut('sessions', session);
  state.recording = true;
  state.sessionId = id;
  mem.debuggerFailed = false;
  lastPageByTab.clear();
  persistState();
  updateBadge();

  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.url && /^https?:/.test(tab.url)) {
      await pushNavigate(tab, tab.url, t('navStart'));
      void attachDebugger(tab.id ?? null);
    }
  } catch {
    /* ignore */
  }
  notifySessionUpdated();
  return { ok: true, sessionId: id };
}

export async function stopRecording(): Promise<{ ok: boolean; sessionId?: string | null }> {
  if (!state.recording) return { ok: true };
  const session = await dbGet<RecorderSession>('sessions', state.sessionId!);
  if (session && session.status === 'recording') {
    session.status = 'stopped';
    session.endedAt = Date.now();
    await dbPut('sessions', session);
  }
  state.recording = false;
  persistState();
  updateBadge();
  detachAll();
  mem.webRequestPending.clear();
  lastPageByTab.clear();
  notifySessionUpdated();
  return { ok: true, sessionId: session ? session.id : null };
}

export async function onRecAction(
  msg: { action: Partial<RecordedAction> },
  sender: chrome.runtime.MessageSender
): Promise<{ recorded: boolean; id?: number }> {
  if (!state.recording) return { recorded: false };
  const tab = sender.tab;
  const a = Object.assign({}, msg.action, {
    sessionId: state.sessionId,
    tabId: tab ? tab.id : null,
    windowId: tab ? tab.windowId : null,
  }) as RecordedAction;
  if (!isActionEnabled(a) || isRecorderChrome(a)) return { recorded: false };
  if (!mem.capture.isVueEnabled) a.vue = null;
  const id = await dbAdd<RecordedAction>('actions', a);
  notifySessionUpdated();
  if (tab) void attachDebugger(tab.id ?? null);
  queueShot(id, tab ? tab.id ?? null : null, tab ? tab.windowId ?? null : null);
  return { recorded: true, id };
}

export async function onRecPinia(msg: { event: Omit<PiniaEvent, 'sessionId' | 'ts'> }): Promise<{ recorded: boolean; capped?: boolean }> {
  if (!state.recording || !state.sessionId || !mem.capture.isVueEnabled) return { recorded: false };
  const count = await dbCountByIndex('pinia', 'bySession', state.sessionId);
  if (count >= MAX_PINIA_PER_SESSION) return { recorded: false, capped: true };
  const ev: PiniaEvent = Object.assign({}, msg.event, { sessionId: state.sessionId, ts: Date.now() });
  await dbAdd<PiniaEvent>('pinia', ev);
  notifySessionUpdated();
  return { recorded: true };
}

async function pushNavigate(tab: chrome.tabs.Tab, url: string, label: string): Promise<void> {
  if (!/^https?:/.test(url) || !state.sessionId) return;
  const tabId = tab.id ?? null;
  const canon = pageUrl(url);
  if (tabId != null && lastPageByTab.get(tabId) === canon) return;
  if (tabId != null) lastPageByTab.set(tabId, canon);
  const id = await dbAdd<RecordedAction>('actions', {
    sessionId: state.sessionId,
    kind: 'navigate',
    label,
    url,
    selector: '',
    value: '',
    ts: Date.now(),
    title: (tab && tab.title) || '',
    tabId: tab ? tab.id ?? null : null,
    windowId: tab ? tab.windowId ?? null : null,
  });
  void attachDebugger(tab ? tab.id ?? null : null);
  queueShot(id, tab ? tab.id ?? null : null, tab ? tab.windowId ?? null : null);
  notifySessionUpdated();
}

async function captureShot(windowId: number | null, tabId: number | null): Promise<string | null> {
  if (windowId == null || tabId == null) return null;
  try {
    const t = await chrome.tabs.get(tabId);
    if (!t.active) return null; // 已切走,截到的是别的页面
    return await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 62 });
  } catch {
    return null; // 受保护页 / 正在跳转
  }
}

function isRecorderChrome(a: RecordedAction): boolean {
  const text = `${a.selector || ''} ${a.label || ''}`;
  return text.includes('bugrec-note-host') || text.includes('bugrec-bridge');
}

function isActionEnabled(a: RecordedAction): boolean {
  if (a.kind === 'click') return mem.capture.isClickEnabled;
  if (a.kind === 'keypress') return mem.capture.isKeyboardEnabled;
  if (a.kind === 'input' && a.inputType === 'keyboard') return mem.capture.isKeyboardEnabled;
  return true;
}

function queueShot(actionId: number, tabId: number | null, windowId: number | null): void {
  if (!mem.capture.isScreenshotEnabled) return;
  mem.captureQueue = mem.captureQueue
    .then(async () => {
      await sleep(SHOT_DELAY_MS);
      const shot = await captureShot(windowId, tabId);
      if (!shot) return;
      const a = await dbGet<RecordedAction>('actions', actionId);
      if (a && !a.screenshot) {
        a.screenshot = shot;
        await dbPut('actions', a);
        notifySessionUpdated();
      }
    })
    .catch(() => {});
}
