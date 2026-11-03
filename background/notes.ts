// 右键菜单「记录修改意见」,以及把意见写入当前录制会话。

import { dbAdd } from '../shared/db';
import { state, notifySessionUpdated } from './state';
import type { ChangeNote } from '../shared/types';

const MENU_ID = 'bugrec-note';

export function installNotes(): void {
  if (typeof chrome.contextMenus === 'undefined') return;
  chrome.contextMenus.onClicked.addListener(onMenu);
  const ensure = (): void => {
    chrome.contextMenus.create(
      {
        id: MENU_ID,
        title: '记录修改意见',
        contexts: ['page', 'selection', 'link', 'image', 'editable', 'video', 'audio'],
        documentUrlPatterns: ['http://*/*', 'https://*/*'],
      },
      () => void chrome.runtime.lastError
    );
  };
  chrome.runtime.onInstalled.addListener(ensure);
  ensure();
}

function onMenu(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): void {
  if (info.menuItemId !== MENU_ID || !tab || tab.id == null) return;
  const frameId = typeof info.frameId === 'number' ? info.frameId : undefined;
  const msg = { type: 'OPEN_NOTE', isRecording: state.recording };
  try {
    const p = chrome.tabs.sendMessage(tab.id, msg, frameId == null ? {} : { frameId });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    /* 该帧还没有内容脚本 */
  }
}

export async function onRecNote(note: Partial<ChangeNote>): Promise<{ recorded: boolean }> {
  if (!state.recording || !state.sessionId) return { recorded: false };
  const opinion = String(note.opinion || '').trim();
  if (!opinion || !note.url) return { recorded: false };
  const row: ChangeNote = {
    sessionId: state.sessionId,
    ts: typeof note.ts === 'number' ? note.ts : Date.now(),
    url: String(note.url),
    title: note.title || '',
    selector: note.selector || '',
    label: note.label || '',
    htmlHint: note.htmlHint || '',
    vue: note.vue ?? null,
    opinion: opinion.slice(0, 500),
  };
  await dbAdd<ChangeNote>('notes', row);
  notifySessionUpdated();
  return { recorded: true };
}
