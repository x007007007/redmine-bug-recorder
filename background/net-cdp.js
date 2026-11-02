// CDP 捕获(chrome.debugger,仅 Chrome):XHR/Fetch 响应体 + Console 错误/警告。

import { dbAdd, dbCountByIndex } from '../shared/db.js';
import { state, mem, getSettings, notifySessionUpdated } from './state.js';

const MAX_RESPONSE_BODY = 8 * 1024;
const MAX_LOGS_PER_SESSION = 300;
const TEXTUAL_CT_RE = /json|text|xml|javascript|urlencoded|form|html/i;

export async function attachDebugger(tabId) {
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
    mem.debuggerFailed = true; // 用户取消横幅或页面不支持
  }
}

export function detachAll() {
  for (const tabId of [...mem.debuggerTabs.keys()]) {
    try {
      chrome.debugger.detach({ tabId }).catch(() => {});
    } catch {
      /* ignore */
    }
  }
  mem.debuggerTabs.clear();
}

export function install() {
  if (typeof chrome.debugger === 'undefined') return;
  chrome.debugger.onEvent.addListener(onDebuggerEvent);
  chrome.debugger.onDetach.addListener((source) => {
    if (source && source.tabId != null) mem.debuggerTabs.delete(source.tabId);
  });
}

function onDebuggerEvent(source, method, params) {
  if (!source || source.tabId == null) return;
  const info = mem.debuggerTabs.get(source.tabId);
  if (!info) return;
  const tabId = source.tabId;

  switch (method) {
    case 'Network.requestWillBeSent':
      onRequestWillBeSent(info, params);
      return;
    case 'Network.responseReceived': {
      const e = info.reqs.get(params.requestId);
      if (e) {
        e.status = params.response.status;
        e.contentType = params.response.mimeType;
      }
      return;
    }
    case 'Network.loadingFinished': {
      const e = info.reqs.get(params.requestId);
      if (!e) return;
      info.reqs.delete(params.requestId);
      e.durationMs = Math.max(0, Date.now() - e.ts);
      finalizeCdpRequest(tabId, params.requestId, e);
      return;
    }
    case 'Network.loadingFailed': {
      const e = info.reqs.get(params.requestId);
      if (!e) return;
      info.reqs.delete(params.requestId);
      e.error = params.errorText || 'failed';
      dbAdd('requests', e).catch(() => {});
      notifySessionUpdated();
      return;
    }
    case 'Runtime.consoleAPICalled':
      onConsole(params);
      return;
    case 'Runtime.exceptionThrown': {
      if (!state.recording) return;
      const d = params.exceptionDetails || {};
      addLog(state.sessionId, 'error', [d.text, d.exception && d.exception.description].filter(Boolean).join(' '));
      return;
    }
  }
}

function onRequestWillBeSent(info, params) {
  if (!state.recording) return;
  const isApi = params.type === 'XHR' || params.type === 'Fetch';
  if (!isApi) return;
  info.reqs.set(params.requestId, {
    sessionId: state.sessionId,
    ts: Date.now(),
    method: params.request.method,
    url: params.request.url,
    resourceType: params.type,
    source: 'CDP',
    requestBody: params.request.postData ? clip(params.request.postData, 65536) : '',
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
      e.responseBody = body == null ? null : clip(body, MAX_RESPONSE_BODY);
    } else {
      e.responseBody = null; // 二进制内容不落库
    }
  } catch {
    e.responseBody = undefined;
  }
  dbAdd('requests', e).catch(() => {});
  notifySessionUpdated();
}

function onConsole(params) {
  if (!state.recording) return;
  const levelMap = { warning: 'warning', error: 'error', assert: 'error' };
  const level = levelMap[params.type];
  if (!level) return; // 只保留错误/警告
  const text = (params.args || [])
    .map((arg) => (arg.value !== undefined ? String(arg.value) : arg.description || arg.type || ''))
    .join(' ')
    .slice(0, 500);
  addLog(state.sessionId, level, text);
}

async function addLog(sessionId, level, text) {
  const count = await dbCountByIndex('logs', 'bySession', sessionId);
  if (count >= MAX_LOGS_PER_SESSION) return;
  await dbAdd('logs', { sessionId, ts: Date.now(), level, text: text.slice(0, 500) }).catch(() => {});
}

function clip(s, max) {
  return s.length > max ? s.slice(0, max) + `…(截断,共${s.length}字符)` : s;
}
