// 消息路由:popup / 管理页 → 后台各模块的唯一入口。
// 统一约定:handler 返回值即响应;抛错则响应 { error }。

import { getSettings, state, mem } from './state.js';
import { startRecording, stopRecording, onRecAction, onRecPinia } from './recorder.js';
import { listSessions, getSession, deleteSession, deleteItems } from './sessions.js';
import { redmineEndpoints, submitRedmine } from './redmine-submit.js';

const HANDLERS = {
  REC_ACTION: (msg, sender) => onRecAction(msg, sender),
  REC_PINIA: (msg) => onRecPinia(msg),
  START_RECORDING: () => startRecording(),
  STOP_RECORDING: () => stopRecording(),
  GET_STATE: async () => ({
    recording: state.recording,
    sessionId: state.sessionId,
    debuggerFailed: mem.debuggerFailed,
  }),
  LIST_SESSIONS: () => listSessions(),
  GET_SESSION: (msg) => getSession(msg.id),
  DELETE_SESSION: (msg) => deleteSession(msg.id),
  DELETE_ITEMS: (msg) => deleteItems(msg.sessionId, msg.actionIds, msg.requestIds, msg.piniaIds),
  SETTINGS_GET: () => getSettings(),
  SETTINGS_SET: async (msg) => {
    await chrome.storage.local.set({ recorderSettings: msg.settings });
    return { ok: true };
  },
  SUBMIT_REDMINE: (msg) => submitRedmine(msg),
  ...redmineEndpoints,
};

export function install() {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const handler = HANDLERS[msg && msg.type];
    if (!handler) {
      sendResponse({ error: `未知消息类型: ${msg && msg.type}` });
      return true;
    }
    Promise.resolve()
      .then(() => handler(msg, sender))
      .then((result) => sendResponse(result || { ok: true }))
      .catch((e) => sendResponse({ error: String((e && e.message) || e) }));
    return true; // 异步响应
  });
}
