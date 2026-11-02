// 后台编排:
//  1. 录制会话状态(persist 到 storage.session,service worker 休眠后可恢复)
//  2. 接收 content script 的操作事件 → 写入 IndexedDB → 延迟截图(等 UI 渲染)
//  3. 网络捕获:webRequest(元数据+表单请求体) + chrome.debugger/CDP(响应体+Console,仅 Chrome)
//  4. 消息路由:popup / manager 页的全部请求
//  5. Redmine 提交:uploads.json → issues.json

import {
  dbAdd,
  dbGet,
  dbPut,
  dbDelete,
  dbAll,
  dbListByIndex,
  dbCountByIndex,
  clearSessionData,
} from '../shared/db.js';
import {
  testConnection,
  listProjects,
  listTrackers,
  listPriorities,
  uploadAttachment,
  createIssue,
  dataUrlToBytes,
} from '../shared/redmine.js';

const SETTINGS_KEY = 'recorderSettings';
const API_TYPES = new Set(['xmlhttprequest', 'fetch']);
const URL_PATTERNS = ['http://*/*', 'https://*/*'];
const MAX_RESPONSE_BODY = 8 * 1024;
const MAX_LOGS_PER_SESSION = 300;
const MAX_PINIA_PER_SESSION = 500;
const SHOT_DELAY_MS = 380; // 截图前等待 UI 渲染

const state = { recording: false, sessionId: null };
const mem = {
  debuggerTabs: new Map(), // tabId -> { reqs: Map<cdpRequestId, entry> }
  webRequestPending: new Map(), // webRequestId -> entry
  captureQueue: Promise.resolve(),
  debuggerFailed: false,
  logCount: new Map(), // sessionId -> count
};

/* ---------------- 初始化与状态 ---------------- */

init();

async function init() {
  try {
    const stored = await chrome.storage.session.get('state');
    if (stored && stored.state && stored.state.recording && stored.state.sessionId) {
      // service worker 曾休眠/重启,恢复录制状态
      state.recording = true;
      state.sessionId = stored.state.sessionId;
    }
  } catch {
    /* storage.session 不可用时忽略 */
  }
  updateBadge();
}

function persistState() {
  try {
    chrome.storage.session.set({ state: { ...state } });
  } catch {
    /* ignore */
  }
}

function updateBadge() {
  const text = state.recording ? 'REC' : '';
  try {
    chrome.action.setBadgeText({ text });
    if (state.recording) chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  } catch {
    /* ignore */
  }
}

async function getSettings() {
  const o = await chrome.storage.local.get(SETTINGS_KEY);
  return Object.assign({ captureBodies: true, attachScreenshots: true }, o[SETTINGS_KEY] || {});
}

function notifySessionUpdated() {
  try {
    const p = chrome.runtime.sendMessage({ type: 'SESSION_UPDATED', sessionId: state.sessionId });
    if (p && p.catch) p.catch(() => {});
  } catch {
    /* popup/manager 未打开时忽略 */
  }
}

/* ---------------- 消息路由 ---------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then((result) => sendResponse(result || { ok: true }))
    .catch((e) => sendResponse({ error: String((e && e.message) || e) }));
  return true; // 异步响应
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case 'REC_ACTION':
      return onRecAction(msg, sender);
    case 'REC_PINIA':
      return onRecPinia(msg);
    case 'START_RECORDING':
      return startRecording();
    case 'STOP_RECORDING':
      return stopRecording();
    case 'GET_STATE':
      return {
        recording: state.recording,
        sessionId: state.sessionId,
        debuggerFailed: mem.debuggerFailed,
      };
    case 'LIST_SESSIONS':
      return listSessions();
    case 'GET_SESSION':
      return getSession(msg.id);
    case 'DELETE_SESSION':
      await clearSessionData(msg.id);
      return { ok: true };
    case 'SETTINGS_GET':
      return getSettings();
    case 'SETTINGS_SET':
      await chrome.storage.local.set({ [SETTINGS_KEY]: msg.settings });
      return { ok: true };
    case 'TEST_REDMINE':
      return testConnection(await getSettings());
    case 'LIST_PROJECTS':
      return listProjects(await getSettings());
    case 'LIST_TRACKERS':
      return listTrackers(await getSettings());
    case 'LIST_PRIORITIES':
      return listPriorities(await getSettings());
    case 'SUBMIT_REDMINE':
      return submitRedmine(msg);
    default:
      throw new Error(`未知消息类型: ${msg && msg.type}`);
  }
}

/* ---------------- 录制:开始 / 停止 / 事件 ---------------- */

async function startRecording() {
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
  mem.logCount.set(id, 0);
  persistState();
  updateBadge();

  // 对当前活动页做一次"起点"记录 + 截图
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

async function stopRecording() {
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
  for (const tabId of [...mem.debuggerTabs.keys()]) {
    detachDebugger(tabId);
  }
  mem.webRequestPending.clear();
  notifySessionUpdated();
  return { ok: true, sessionId: session ? session.id : state.sessionId };
}

async function onRecAction(msg, sender) {
  if (!state.recording) return { recorded: false };
  const tab = (sender && sender.tab) || {};
  const a = Object.assign({}, msg.action, {
    sessionId: state.sessionId,
    tabId: tab.id,
    windowId: tab.windowId,
  });
  const id = await dbAdd('actions', a);
  notifySessionUpdated();
  // 首次收到某 tab 的事件时,确保调试器已挂(拿响应体/Console)
  attachDebugger(tab.id);
  queueShot(id, tab.windowId);
  return { recorded: true, id };
}

// Pinia 变更流($subscribe / $onAction),按时间戳与步骤关联
async function onRecPinia(msg) {
  if (!state.recording) return { recorded: false };
  const count = (await dbCountByIndex('pinia', 'bySession', state.sessionId)) || 0;
  if (count >= MAX_PINIA_PER_SESSION) return { recorded: false, capped: true };
  const ev = Object.assign({}, msg.event, { sessionId: state.sessionId, ts: Date.now() });
  await dbAdd('pinia', ev);
  notifySessionUpdated();
  return { recorded: true };
}

// 页面导航(整页加载 / SPA 路由变化)也作为一步记录
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!state.recording) return;
  if (changeInfo.url && tab && tab.url && /^https?:/.test(tab.url)) {
    pushNavigate(tab, changeInfo.url, '跳转到');
  }
});

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
  queueShot(id, tab ? tab.windowId : undefined);
  notifySessionUpdated();
}

/* ---------------- 截图管线(串行队列,防止并发轰炸) ---------------- */

async function captureShot(windowId) {
  if (windowId == null) return null;
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 62 });
  } catch {
    return null; // 页面不可截(受保护页 / 正在跳转)
  }
}

function queueShot(actionId, windowId) {
  mem.captureQueue = mem.captureQueue
    .then(async () => {
      await sleep(SHOT_DELAY_MS);
      const shot = await captureShot(windowId);
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ---------------- 网络捕获:webRequest(全浏览器) ---------------- */

chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, { urls: URL_PATTERNS }, ['requestBody']);

function onBeforeRequest(details) {
  if (!state.recording || !API_TYPES.has(details.type)) return;
  if (details.tabId != null && mem.debuggerTabs.has(details.tabId)) return; // 该 tab 由 CDP 负责避免重复
  if ((details.initiator || '').startsWith('chrome-extension://')) return;
  mem.webRequestPending.set(details.requestId, {
    sessionId: state.sessionId,
    ts: details.timeStamp,
    method: details.method,
    url: details.url,
    resourceType: details.type,
    source: 'webRequest',
    requestBody: clipBody(flattenFormData(details.requestBody), 2048),
  });
}

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const e = mem.webRequestPending.get(details.requestId);
    if (!e) return;
    mem.webRequestPending.delete(details.requestId);
    e.status = details.statusCode;
    e.durationMs = Math.max(0, Math.round(details.timeStamp - e.ts));
    e.contentType = pickHeader(details.responseHeaders, 'content-type');
    dbAdd('requests', e).catch(() => {});
    notifySessionUpdated();
  },
  { urls: URL_PATTERNS },
  ['responseHeaders']
);

chrome.webRequest.onErrorOccurred.addListener((details) => {
  const e = mem.webRequestPending.get(details.requestId);
  if (!e) return;
  mem.webRequestPending.delete(details.requestId);
  e.error = details.error;
  dbAdd('requests', e).catch(() => {});
  notifySessionUpdated();
}, { urls: URL_PATTERNS });

function flattenFormData(body) {
  if (!body || !body.formData) return '';
  return Object.entries(body.formData)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`)
    .join('&')
    .slice(0, 2048);
}

function clipBody(s, max) {
  s = String(s == null ? '' : s);
  return s.length > max ? s.slice(0, max) + `…(截断,共${s.length}字符)` : s;
}

function pickHeader(headers, name) {
  if (!headers) return undefined;
  const h = headers.find((x) => x.name.toLowerCase() === name);
  return h ? h.value : undefined;
}

/* ---------------- 网络捕获:chrome.debugger / CDP(响应体 + Console,仅 Chrome) ---------------- */

async function attachDebugger(tabId) {
  if (tabId == null || typeof chrome.debugger === 'undefined') return;
  if (mem.debuggerTabs.has(tabId)) return;
  const settings = await getSettings();
  if (!settings.captureBodies) return;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    mem.debuggerTabs.set(tabId, { reqs: new Map() });
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable', { maxPostDataSize: 65536 });
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable').catch(() => {});
  } catch {
    // 用户点了横幅上的"取消",或页面不支持调试
    mem.debuggerFailed = true;
  }
}

function detachDebugger(tabId) {
  try {
    chrome.debugger.detach({ tabId }).catch(() => {});
  } catch {
    /* ignore */
  }
  mem.debuggerTabs.delete(tabId);
}

if (typeof chrome.debugger !== 'undefined') {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (!source || source.tabId == null) return;
    const info = mem.debuggerTabs.get(source.tabId);
    if (!info) return;
    const tabId = source.tabId;

    if (method === 'Network.requestWillBeSent') {
      if (!state.recording) return;
      // CDP 的 resourceType: XHR / Fetch
      const isApi = params.type === 'XHR' || params.type === 'Fetch';
      if (!isApi) return;
      info.reqs.set(params.requestId, {
        sessionId: state.sessionId,
        ts: Date.now(),
        method: params.request.method,
        url: params.request.url,
        resourceType: params.type,
        source: 'CDP',
        requestBody: params.request.postData
          ? clipBody(params.request.postData, 65536)
          : '',
      });
      return;
    }
    if (method === 'Network.responseReceived') {
      const e = info.reqs.get(params.requestId);
      if (!e) return;
      e.status = params.response.status;
      e.contentType = params.response.mimeType;
      return;
    }
    if (method === 'Network.loadingFinished') {
      const e = info.reqs.get(params.requestId);
      if (!e) return;
      info.reqs.delete(params.requestId);
      e.durationMs = Math.max(0, Date.now() - e.ts);
      finalizeCdpRequest(tabId, params.requestId, e);
      return;
    }
    if (method === 'Network.loadingFailed') {
      const e = info.reqs.get(params.requestId);
      if (!e) return;
      info.reqs.delete(params.requestId);
      e.error = params.errorText || 'failed';
      dbAdd('requests', e).catch(() => {});
      notifySessionUpdated();
      return;
    }
    if (method === 'Runtime.consoleAPICalled') {
      if (!state.recording) return;
      const levelMap = { log: 'log', warning: 'warning', error: 'error', info: 'info', debug: 'log', assert: 'error' };
      const level = levelMap[params.type] || 'log';
      if (level !== 'error' && level !== 'warning') return; // 只保留错误/警告,控制存储量
      const text = (params.args || [])
        .map((arg) => {
          if (arg.value !== undefined) return String(arg.value);
          if (arg.description) return arg.description;
          return arg.type || '';
        })
        .join(' ')
        .slice(0, 500);
      addLog(state.sessionId, level, text);
      return;
    }
    if (method === 'Runtime.exceptionThrown') {
      if (!state.recording) return;
      const d = params.exceptionDetails || {};
      const text = [d.text, d.exception && d.exception.description].filter(Boolean).join(' ').slice(0, 500);
      addLog(state.sessionId, 'error', text);
    }
  });

  chrome.debugger.onDetach.addListener((source) => {
    if (source && source.tabId != null) mem.debuggerTabs.delete(source.tabId);
  });
}

async function finalizeCdpRequest(tabId, cdpRequestId, e) {
  try {
    const resp = await chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', {
      requestId: cdpRequestId,
    });
    const ct = e.contentType || '';
    if (TEXTUAL_CT_RE.test(ct) || (!ct && typeof resp.body === 'string')) {
      let body = resp.body;
      if (resp.base64Encoded) {
        try {
          body = atob(body);
        } catch {
          body = null;
        }
      }
      e.responseBody = body == null ? null : clipBody(body, MAX_RESPONSE_BODY);
    } else {
      e.responseBody = null; // 二进制内容不落库
    }
  } catch {
    e.responseBody = undefined; // 拿不到(如 304 / 已驱逐)
  }
  dbAdd('requests', e).catch(() => {});
  notifySessionUpdated();
}

const TEXTUAL_CT_RE = /json|text|xml|javascript|urlencoded|form|html/i;

async function addLog(sessionId, level, text) {
  const count = mem.logCount.get(sessionId) || 0;
  if (count >= MAX_LOGS_PER_SESSION) return;
  mem.logCount.set(sessionId, count + 1);
  await dbAdd('logs', { sessionId, ts: Date.now(), level, text }).catch(() => {});
}

/* ---------------- 会话查询 ---------------- */

async function listSessions() {
  const sessions = await dbAll('sessions');
  sessions.sort((a, b) => b.startedAt - a.startedAt);
  const out = [];
  for (const s of sessions) {
    out.push({
      ...s,
      actionCount: await dbCountByIndex('actions', 'bySession', s.id),
      requestCount: await dbCountByIndex('requests', 'bySession', s.id),
      logCount: await dbCountByIndex('logs', 'bySession', s.id),
      piniaCount: await dbCountByIndex('pinia', 'bySession', s.id),
    });
  }
  return out;
}

async function getSession(id) {
  const session = await dbGet('sessions', id);
  if (!session) throw new Error('会话不存在');
  const actions = (await dbListByIndex('actions', 'bySession', id)).sort((a, b) => a.id - b.id);
  const requests = (await dbListByIndex('requests', 'bySession', id)).sort((a, b) => a.ts - b.ts);
  const logs = (await dbListByIndex('logs', 'bySession', id)).sort((a, b) => a.ts - b.ts).slice(-100);
  const pinia = (await dbListByIndex('pinia', 'bySession', id)).sort((a, b) => a.ts - b.ts);
  return { session, actions, requests, logs, pinia };
}

/* ---------------- 提交 Redmine ---------------- */

async function submitRedmine(msg) {
  const settings = await getSettings();
  const { session, actions: allActions } = await getSession(msg.sessionId);

  // 只提交测试人员勾选的步骤(截图附件与描述中的编号按同一顺序生成)
  const selectedIds = Array.isArray(msg.selectedActionIds) ? msg.selectedActionIds : null;
  const actions = selectedIds ? allActions.filter((a) => selectedIds.includes(a.id)) : allActions;

  const uploads = [];
  let shotNo = 0;
  if (msg.attachScreenshots) {
    const shots = actions.filter((a) => a.screenshot);
    for (const a of shots) {
      shotNo += 1;
      const filename = `step-${String(shotNo).padStart(2, '0')}.jpg`;
      const upload = await uploadAttachment(settings, filename, dataUrlToBytes(a.screenshot));
      if (upload && upload.token) {
        uploads.push({ token: upload.token, filename, content_type: 'image/jpeg' });
      }
    }
  }

  const issue = {
    project_id: msg.projectId,
    subject: msg.subject,
    description: msg.description,
  };
  if (msg.trackerId) issue.tracker_id = Number(msg.trackerId);
  if (msg.priorityId) issue.priority_id = Number(msg.priorityId);
  if (uploads.length) issue.uploads = uploads;

  const resp = await createIssue(settings, { issue });
  const issueId = resp && resp.issue ? resp.issue.id : null;

  session.status = 'submitted';
  session.issueId = issueId;
  session.issueUrl = issueId ? `${settings.redmineUrl.replace(/\/+$/, '')}/issues/${issueId}` : null;
  await dbPut('sessions', session);
  notifySessionUpdated();

  return { issueId, issueUrl: session.issueUrl, uploadCount: uploads.length };
}
