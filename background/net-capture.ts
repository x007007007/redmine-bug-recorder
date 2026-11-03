// 网络捕获(webRequest):XHR/Fetch 元数据 + 表单请求体。
// 响应体与 Console 由 net-cdp.ts(chrome.debugger)负责,该 tab 存在时跳过避免重复。
// 「当前页」只记正在看的标签;插件自己的请求和发往已配置 Redmine 的请求一律不记。

import { shouldRecordRequest } from '../shared/capture';
import { t } from '../shared/i18n';
import { dbAdd } from '../shared/db';
import { state, mem, notifySessionUpdated } from './state';
import { installNetCdp } from './net-cdp';
import type { RequestEntry } from '../shared/types';

const API_TYPES = new Set(['xmlhttprequest', 'fetch']);
const URL_PATTERNS = ['http://*/*', 'https://*/*'];
type NoBlock = chrome.webRequest.BlockingResponse | undefined;

export function installNetCapture(): void {
  watchActiveTab();
  chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, { urls: URL_PATTERNS }, ['requestBody']);
  chrome.webRequest.onCompleted.addListener(onCompleted, { urls: URL_PATTERNS }, ['responseHeaders']);
  chrome.webRequest.onErrorOccurred.addListener(onError, { urls: URL_PATTERNS });
  installNetCdp();
}

function watchActiveTab(): void {
  const mark = (tabId: number | undefined): void => {
    if (tabId != null && tabId >= 0) mem.activeTabId = tabId;
  };
  chrome.tabs.onActivated.addListener((info) => mark(info.tabId));
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    chrome.tabs.query({ active: true, windowId }, (tabs) => mark(tabs[0]?.id));
  });
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => mark(tabs[0]?.id));
}

export { attachDebugger, detachAll } from './net-cdp';

function onBeforeRequest(details: chrome.webRequest.OnBeforeRequestDetails): NoBlock {
  if (!state.recording || !mem.capture.isRequestEnabled || !API_TYPES.has(details.type)) return undefined;
  if (details.tabId != null && mem.debuggerTabs.has(details.tabId)) return undefined; // 该 tab 由 CDP 负责
  const extra = details as chrome.webRequest.OnBeforeRequestDetails & { originUrl?: string; documentUrl?: string };
  if (
    !shouldRecordRequest(
      {
        tabId: details.tabId,
        url: details.url,
        initiator: details.initiator,
        originUrl: extra.originUrl,
        documentUrl: extra.documentUrl,
      },
      mem.capture.isRequestPageOnly,
      mem.activeTabId,
      mem.redmineBase
    )
  ) {
    return undefined;
  }
  mem.webRequestPending.set(details.requestId, {
    sessionId: state.sessionId!,
    ts: details.timeStamp,
    method: details.method,
    url: details.url,
    resourceType: details.type,
    source: 'webRequest',
    requestBody: clipBody(String(flattenFormData(details.requestBody)), 2048),
  });
  return undefined;
}

function onCompleted(details: chrome.webRequest.OnCompletedDetails): NoBlock {
  const e = mem.webRequestPending.get(details.requestId);
  if (!e) return undefined;
  mem.webRequestPending.delete(details.requestId);
  if (!mem.capture.isRequestEnabled) return undefined;
  e.status = details.statusCode;
  e.durationMs = Math.max(0, Math.round(details.timeStamp - e.ts));
  e.contentType = pickHeader(details.responseHeaders, 'content-type');
  dbAdd<RequestEntry>('requests', e).catch(() => {});
  notifySessionUpdated();
  return undefined;
}

function onError(details: chrome.webRequest.OnErrorOccurredDetails): NoBlock {
  const e = mem.webRequestPending.get(details.requestId);
  if (!e) return undefined;
  mem.webRequestPending.delete(details.requestId);
  if (!mem.capture.isRequestEnabled) return undefined;
  e.error = details.error;
  dbAdd<RequestEntry>('requests', e).catch(() => {});
  notifySessionUpdated();
  return undefined;
}

function flattenFormData(body?: { formData?: { [key: string]: chrome.webRequest.FormDataItem[] } }): string {
  if (!body || !body.formData) return '';
  return Object.entries(body.formData)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`)
    .join('&');
}

function pickHeader(headers: chrome.webRequest.HttpHeader[] | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const h = headers.find((x) => x.name.toLowerCase() === name);
  return h ? String(h.value ?? '') : undefined;
}

function clipBody(s: string, max: number): string {
  return s.length > max ? t('clip', [s.slice(0, max), String(s.length)]) : s;
}
