// 录制编排:开始/停止、接收操作与 Pinia 事件、导航步骤、截图管线。
// 截图在操作约 380ms 后截取(UI 渲染后);若届时该标签页已不是可见页,宁可不截,避免拍到错误页面。

import { dbAdd, dbGet, dbPut, dbCountByIndex } from '../shared/db.js';
import { state, mem, sleep, persistState, updateBadge, notifySessionUpdated } from './state.js';
import { attachDebugger, detachAll } from './net-cdp.js';

const SHOT_DELAY_MS = 380;
const MAX_PINIA_PER_SESSION = 500;

export function install() {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!state.recording) return;
    if (changeInfo.url && tab && tab.url && /^https?:/.test(tab.url)) {
      pushNavigate(tab, changeInfo.url, '跳转到');
    }
  });
}

export async function startRecording() {
  if (state.recording) return { ok: true, sessionId: state.sessionId, already: true };
  const id = crypto.randomUUID();
  await dbPut('sessions', {
    id,
    startedAt: Date.now(),
    endedAt: null,
    status: 'recording',
    subject: '',
    issueId: null,
    issueUrl: null,
  });
  state.recording = true;
  state.sessionId = id;
  mem.debuggerFailed = false;
  persistState();
  updateBadge();

  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.url && /^https?:/.test(tab.url)) {
      await pushNavigate(tab, tab.url, '开始录制');
      attachDebugger(tab.id);
    }
  } catch {
    /* ignore */
  }
  notifySessionUpdated();
  return { ok: true, sessionId: id };
}

export async function stopRecording() {
  if (!state.recording) return { ok: true };
  const session = await dbGet('sessions', state.sessionId);
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
  notifySessionUpdated();
  return { ok: true, sessionId: session ? session.id : null };
}

export async function onRecAction(msg, sender) {
  if (!state.recording) return { recorded: false };
  const tab = (sender && sender.tab) || {};
  const a = Object.assign({}, msg.action, {
    sessionId: state.sessionId,
    tabId: tab.id,
    windowId: tab.windowId,
  });
  const id = await dbAdd('actions', a);
  notifySessionUpdated();
  attachDebugger(tab.id);
  queueShot(id, tab.id, tab.windowId);
  return { recorded: true, id };
}

export async function onRecPinia(msg) {
  if (!state.recording) return { recorded: false };
  const count = await dbCountByIndex('pinia', 'bySession', state.sessionId);
  if (count >= MAX_PINIA_PER_SESSION) return { recorded: false, capped: true };
  const ev = Object.assign({}, msg.event, { sessionId: state.sessionId, ts: Date.now() });
  await dbAdd('pinia', ev);
  notifySessionUpdated();
  return { recorded: true };
}

async function pushNavigate(tab, url, label) {
  if (!/^https?:/.test(url)) return;
  const id = await dbAdd('actions', {
    sessionId: state.sessionId,
    kind: 'navigate',
    label,
    url,
    selector: '',
    value: '',
    ts: Date.now(),
    title: (tab && tab.title) || '',
    tabId: tab && tab.id,
    windowId: tab && tab.windowId,
  });
  attachDebugger(tab ? tab.id : undefined);
  queueShot(id, tab ? tab.id : null, tab ? tab.windowId : undefined);
  notifySessionUpdated();
}

async function captureShot(windowId, tabId) {
  if (windowId == null || tabId == null) return null;
  try {
    const t = await chrome.tabs.get(tabId);
    if (!t.active) return null; // 已切走,截到的是别的页面
    return await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 62 });
  } catch {
    return null; // 受保护页 / 正在跳转
  }
}

function queueShot(actionId, tabId, windowId) {
  mem.captureQueue = mem.captureQueue
    .then(async () => {
      await sleep(SHOT_DELAY_MS);
      const shot = await captureShot(windowId, tabId);
      if (!shot) return;
      const a = await dbGet('actions', actionId);
      if (a && !a.screenshot) {
        a.screenshot = shot;
        await dbPut('actions', a);
        notifySessionUpdated();
      }
    })
    .catch(() => {});
}
