// 消息路由:popup / 管理页 → 后台各模块的唯一入口。
// 统一约定:handler 返回值即响应;抛错则响应 { error }。

import { isLocalePref, t, useLocale } from '../shared/i18n';
import type { CaptureFlags } from '../shared/capture';
import type { ChangeNote, RecorderSettings } from '../shared/types';
import { getSettings, state, mem, saveCapture, currentState, whenCaptureReady, rememberRedmineBase } from './state';
import { startRecording, stopRecording, onRecAction, onRecPinia } from './recorder';
import { listSessions, getSession, deleteSession, deleteItems, importSession } from './sessions';
import { getSelection, setSelection } from './selection';
import { redmineEndpoints, submitRedmine } from './redmine-submit';
import { refreshDebuggerAttachment, recordPageConsole } from './net-cdp';
import { onRecNote, refreshNoteMenu } from './notes';

type Msg = { type: string } & Record<string, unknown>;
type Handler = (msg: Msg, sender: chrome.runtime.MessageSender) => Promise<unknown>;

const HANDLERS: Record<string, Handler> = {
  REC_ACTION: (msg, sender) => onRecAction(msg as unknown as { action: never }, sender),
  REC_PINIA: (msg) => onRecPinia(msg as unknown as { event: never }),
  REC_LOG: (msg) => Promise.resolve(recordPageConsole(String(msg.level || ''), String(msg.text || ''))),
  REC_NOTE: (msg) => onRecNote((msg.note || {}) as Partial<ChangeNote>),
  START_RECORDING: () => startRecording(),
  STOP_RECORDING: () => stopRecording(),
  GET_STATE: async () => {
    await whenCaptureReady();
    return currentState();
  },
  SET_CAPTURE: async (msg) => {
    const flags = await saveCapture((msg.capture as Partial<CaptureFlags>) || {});
    if (state.recording) await refreshDebuggerAttachment();
    return flags;
  },
  LIST_SESSIONS: () => listSessions(),
  GET_SESSION: (msg) => getSession(String(msg.id)),
  GET_SELECTION: (msg) => getSelection(String(msg.sessionId)),
  SET_SELECTION: (msg) => setSelection(String(msg.sessionId), (msg.ids as number[]) || []),
  DELETE_SESSION: (msg) => deleteSession(String(msg.id)),
  IMPORT_SESSION: (msg) => importSession(msg.data),
  DELETE_ITEMS: (msg) =>
    deleteItems(
      String(msg.sessionId),
      (msg.actionIds as number[]) || [],
      (msg.requestIds as number[]) || [],
      (msg.piniaIds as number[]) || []
    ),
  SETTINGS_GET: () => getSettings(),
  SETTINGS_SET: async (msg) => {
    await whenCaptureReady();
    const settings = { ...(msg.settings as RecorderSettings), capture: mem.capture };
    if (isLocalePref(settings.locale)) useLocale(settings.locale);
    rememberRedmineBase(settings.redmineUrl);
    await chrome.storage.local.set({ recorderSettings: settings });
    refreshNoteMenu();
    return { ok: true };
  },
  SUBMIT_REDMINE: (msg) => submitRedmine(msg as unknown as Parameters<typeof submitRedmine>[0]),
  ...redmineEndpoints,
};

export function installRouter(): void {
  chrome.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
    const handler = HANDLERS[msg && msg.type];
    if (!handler) {
      sendResponse({ error: t('errUnknown', String(msg && msg.type)) });
      return true;
    }
    Promise.resolve()
      .then(() => handler(msg, sender))
      .then((result) => sendResponse(result || { ok: true }))
      .catch((e) => sendResponse({ error: String((e as { message?: string } | null)?.message ?? e) }));
    return true; // 异步响应
  });
}
