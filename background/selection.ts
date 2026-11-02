// 勾选步骤集合的持久化(storage.session):DevTools 面板与提交页双向共享。
// key: selection:<sessionId> → number[](action id 列表);缺失视为"全选"。

import { dbListByIndex } from '../shared/db';
import type { RecordedAction } from '../shared/types';

const keyFor = (sessionId: string): string => `selection:${sessionId}`;

function area(): chrome.storage.StorageArea {
  return chrome.storage.session || chrome.storage.local;
}

export async function getSelection(sessionId: string): Promise<{ sessionId: string; ids: number[] | null }> {
  try {
    const data = (await area().get(keyFor(sessionId))) as Record<string, number[] | undefined>;
    const ids = data[keyFor(sessionId)];
    return { sessionId, ids: Array.isArray(ids) ? ids : null };
  } catch {
    return { sessionId, ids: null };
  }
}

export async function setSelection(sessionId: string, ids: number[]): Promise<{ ok: true }> {
  await area().set({ [keyFor(sessionId)]: ids });
  return { ok: true };
}

/** 当前会话全部 action id(默认全选用) */
export async function allActionIds(sessionId: string): Promise<number[]> {
  const actions = await dbListByIndex<RecordedAction>('actions', 'bySession', sessionId);
  return actions.map((a) => a.id!).filter((x) => x != null);
}
