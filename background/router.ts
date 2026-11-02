// 消息路由:popup / 管理页 → 后台各模块的唯一入口。
// 统一约定:handler 返回值即响应;抛错则响应 { error }。

import { getSettings, state, mem } from './state';
import { startRecording, stopRecording, onRecAction, onRecPinia } from './recorder';
import { listSessions, getSession, deleteSession, deleteItems } from './sessions';
import { getSelection, setSelection } from './selection';
import { redmineEndpoints, submitRedmine } from './redmine-submit';
import type { RecorderSettings } from '../shared/types';

type Msg = { type: string } & Record<string, unknown>;
type Handler = (msg: Msg, sender: chrome.runtime.MessageSender) => Promise<unknown>;

const HANDLERS: Record<string, Handler> = {
  REC_ACTION: (msg, sender) => onRecAction(msg as unknown as { action: never }, sender),
  REC_PINIA: (msg) => onRecPinia(msg as unknown as { event: never }),
  START_RECORDING: () => startRecording(),
  STOP_RECORDING: () => stopRecording(),
  GET_STATE: async () => ({
    recording: state.recording,
    sessionId: state.sessionId,
    debuggerFailed: mem.debuggerFailed,
  }),
  LIST_SESSIONS: () => listSessions(),
  GET_SESSION: (msg) => getSession(String(msg.id)),
  GET_SELECTION: (msg) => getSelection(String(msg.sessionId)),
  SET_SELECTION: (msg) => setSelection(String(msg.sessionId), (msg.ids as number[]) || []),
  DELETE_SESSION: (msg) => deleteSession(String(msg.id)),
  DELETE_ITEMS: (msg) =>
    deleteItems(
      String(msg.sessionId),
      (msg.actionIds as number[]) || [],
      (msg.requestIds as number[]) || [],
      (msg.piniaIds as number[]) || []
    ),
  SETTINGS_GET: () => getSettings(),
  SETTINGS_SET: async (msg) => {
    await chrome.storage.local.set({ recorderSettings: msg.settings as RecorderSettings });
    return { ok: true };
  },
  SUBMIT_REDMINE: (msg) => submitRedmine(msg as unknown as Parameters<typeof submitRedmine>[0]),
  ...redmineEndpoints,
};

export function installRouter(): void {
  chrome.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
    const handler = HANDLERS[msg && msg.type];
    if (!handler) {
      sendResponse({ error: `未知消息类型: ${msg && msg.type}` });
      return true;
    }
    Promise.resolve()
      .then(() => handler(msg, sender))
      .then((result) => sendResponse(result || { ok: true }))
      .catch((e) => sendResponse({ error: String((e as { message?: string } | null)?.message ?? e) }));
    return true; // 异步响应
  });
}
