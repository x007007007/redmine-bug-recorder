// 网络捕获(webRequest,全浏览器):XHR/Fetch 元数据 + 表单请求体。
// 响应体与 Console 由 net-cdp.js(chrome.debugger)负责,该 tab 存在时跳过避免重复。

import { dbAdd } from '../shared/db.js';
import { state, mem, notifySessionUpdated } from './state.js';
import { install as installCdp } from './net-cdp.js';

const API_TYPES = new Set(['xmlhttprequest', 'fetch']);
const URL_PATTERNS = ['http://*/*', 'https://*/*'];

export function install() {
  chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, { urls: URL_PATTERNS }, ['requestBody']);
  chrome.webRequest.onCompleted.addListener(onCompleted, { urls: URL_PATTERNS }, ['responseHeaders']);
  chrome.webRequest.onErrorOccurred.addListener(onError, { urls: URL_PATTERNS });
  installCdp();
}

export { attachDebugger, detachAll } from './net-cdp.js';

function onBeforeRequest(details) {
  if (!state.recording || !API_TYPES.has(details.type)) return;
  if (details.tabId != null && mem.debuggerTabs.has(details.tabId)) return; // 该 tab 由 CDP 负责
  if ((details.initiator || '').startsWith('chrome-extension://')) return;
  mem.webRequestPending.set(details.requestId, {
    sessionId: state.sessionId,
    ts: details.timeStamp,
    method: details.method,
    url: details.url,
    resourceType: details.type,
    source: 'webRequest',
    requestBody: clipBody(String(flattenFormData(details.requestBody)), 2048),
  });
}

function onCompleted(details) {
  const e = mem.webRequestPending.get(details.requestId);
  if (!e) return;
  mem.webRequestPending.delete(details.requestId);
  e.status = details.statusCode;
  e.durationMs = Math.max(0, Math.round(details.timeStamp - e.ts));
  e.contentType = pickHeader(details.responseHeaders, 'content-type');
  dbAdd('requests', e).catch(() => {});
  notifySessionUpdated();
}

function onError(details) {
  const e = mem.webRequestPending.get(details.requestId);
  if (!e) return;
  mem.webRequestPending.delete(details.requestId);
  e.error = details.error;
  dbAdd('requests', e).catch(() => {});
  notifySessionUpdated();
}

function flattenFormData(body) {
  if (!body || !body.formData) return '';
  return Object.entries(body.formData)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`)
    .join('&');
}

function pickHeader(headers, name) {
  if (!headers) return undefined;
  const h = headers.find((x) => x.name.toLowerCase() === name);
  return h ? h.value : undefined;
}

function clipBody(s, max) {
  return s.length > max ? s.slice(0, max) + `…(截断,共${s.length}字符)` : s;
}
