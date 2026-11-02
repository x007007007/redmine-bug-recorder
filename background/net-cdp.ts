// CDP 捕获(chrome.debugger,仅 Chrome):XHR/Fetch 响应体 + Console 错误/警告。

import { dbAdd, dbCountByIndex } from '../shared/db';
import { state, mem, getSettings, notifySessionUpdated } from './state';
import type { LogEntry, RequestEntry } from '../shared/types';

const MAX_RESPONSE_BODY = 8 * 1024;
const MAX_LOGS_PER_SESSION = 300;
const TEXTUAL_CT_RE = /json|text|xml|javascript|urlencoded|form|html/i;

export async function attachDebugger(tabId: number | null | undefined): Promise<void> {
  if (tabId == null || typeof chrome.debugger === 'undefined') return;
  if (mem.debuggerTabs.has(tabId)) return;
  const settings = await getSettings();
  if (!settings.captureBodies) return;
  try {
    await new Promise<void>((resolve, reject) => {
      chrome.debugger.attach({ tabId }, '1.3', () => {
        const e = chrome.runtime.lastError;
        e ? reject(new Error(e.message)) : resolve();
      });
    });
    mem.debuggerTabs.set(tabId, { reqs: new Map() });
    await sendCdp(tabId, 'Network.enable', { maxPostDataSize: 65536 });
    await sendCdp(tabId, 'Runtime.enable').catch(() => {});
  } catch {
    mem.debuggerFailed = true; // 用户取消横幅或页面不支持
  }
}

export function detachAll(): void {
  for (const tabId of [...mem.debuggerTabs.keys()]) {
    try {
      chrome.debugger.detach({ tabId }, () => void chrome.runtime.lastError);
    } catch {
      /* ignore */
    }
  }
  mem.debuggerTabs.clear();
}

function sendCdp<T>(tabId: number, method: string, params?: Record<string, unknown>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params ?? {}, (res?: object) => {
      const e = chrome.runtime.lastError;
      if (e) reject(new Error(e.message));
      else resolve(res as T);
    });
  });
}

export function installNetCdp(): void {
  if (typeof chrome.debugger === 'undefined') return;
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (!source || source.tabId == null) return;
    const info = mem.debuggerTabs.get(source.tabId);
    if (!info) return;
    const tabId = source.tabId;
    const p = (params ?? {}) as Record<string, never>;

    switch (method) {
      case 'Network.requestWillBeSent':
        onRequestWillBeSent(info, p as unknown as CdpRequestWillBeSent);
        return;
      case 'Network.responseReceived': {
        const e = info.reqs.get((p as unknown as CdpResponseReceived).requestId);
        if (e) {
          e.status = (p as unknown as CdpResponseReceived).response.status;
          e.contentType = (p as unknown as CdpResponseReceived).response.mimeType;
        }
        return;
      }
      case 'Network.loadingFinished': {
        const ev = p as unknown as CdpLoadingFinished;
        const e = info.reqs.get(ev.requestId);
        if (!e) return;
        info.reqs.delete(ev.requestId);
        e.durationMs = Math.max(0, Date.now() - e.ts);
        finalizeCdpRequest(tabId, ev.requestId, e);
        return;
      }
      case 'Network.loadingFailed': {
        const ev = p as unknown as CdpLoadingFailed;
        const e = info.reqs.get(ev.requestId);
        if (!e) return;
        info.reqs.delete(ev.requestId);
        e.error = ev.errorText || 'failed';
        dbAdd('requests', e).catch(() => {});
        notifySessionUpdated();
        return;
      }
      case 'Runtime.consoleAPICalled':
        onConsole(p as unknown as CdpConsole);
        return;
      case 'Runtime.exceptionThrown': {
        if (!state.recording) return;
        const d = (p as unknown as CdpException).exceptionDetails ?? { text: '', exception: undefined };
        const text = [d.text, d.exception && d.exception.description].filter(Boolean).join(' ');
        addLog(state.sessionId, 'error', text);
        return;
      }
    }
  });
  chrome.debugger.onDetach.addListener((source) => {
    if (source && source.tabId != null) mem.debuggerTabs.delete(source.tabId);
  });
}

/* ---- 用到的 CDP 事件参数(最小形状) ---- */
interface CdpRequestWillBeSent {
  requestId: string;
  type?: string;
  request: { method: string; url: string; postData?: string };
}
interface CdpResponseReceived {
  requestId: string;
  response: { status: number; mimeType: string };
}
interface CdpLoadingFinished {
  requestId: string;
}
interface CdpLoadingFailed {
  requestId: string;
  errorText?: string;
}
interface CdpConsole {
  type: string;
  args?: { value?: unknown; description?: string; type?: string }[];
}
interface CdpException {
  exceptionDetails: {
    text?: string;
    exception?: { description?: string };
  };
}

function onRequestWillBeSent(info: { reqs: Map<string, RequestEntry> }, params: CdpRequestWillBeSent): void {
  if (!state.recording) return;
  const isApi = params.type === 'XHR' || params.type === 'Fetch';
  if (!isApi) return;
  info.reqs.set(params.requestId, {
    sessionId: state.sessionId!,
    ts: Date.now(),
    method: params.request.method,
    url: params.request.url,
    resourceType: params.type,
    source: 'CDP',
    requestBody: params.request.postData ? clip(params.request.postData, 65536) : '',
  });
}

async function finalizeCdpRequest(tabId: number, cdpRequestId: string, e: RequestEntry): Promise<void> {
  try {
    const resp = await sendCdp<{ body: string; base64Encoded: boolean }>(tabId, 'Network.getResponseBody', {
      requestId: cdpRequestId,
    });
    const ct = e.contentType || '';
    if (TEXTUAL_CT_RE.test(ct) || (!ct && typeof resp.body === 'string')) {
      let body: string | null = resp.body;
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

function onConsole(params: CdpConsole): void {
  if (!state.recording) return;
  const levelMap: Record<string, LogEntry['level']> = { warning: 'warning', error: 'error', assert: 'error' };
  const level = levelMap[params.type];
  if (!level) return; // 只保留错误/警告
  const text = (params.args || [])
    .map((arg) => (arg.value !== undefined ? String(arg.value) : arg.description || arg.type || ''))
    .join(' ')
    .slice(0, 500);
  addLog(state.sessionId, level, text);
}

async function addLog(sessionId: string | null, level: LogEntry['level'], text: string): Promise<void> {
  if (!sessionId) return;
  const count = await dbCountByIndex('logs', 'bySession', sessionId);
  if (count >= MAX_LOGS_PER_SESSION) return;
  await dbAdd<LogEntry>('logs', { sessionId, ts: Date.now(), level, text: text.slice(0, 500) }).catch(() => {});
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `…(截断,共${s.length}字符)` : s;
}
