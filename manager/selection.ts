// 提交页侧的勾选集合读写:与 DevTools 面板经 storage.session 双向同步(缺失=全选)。

import { send } from './api';
import { store } from './store';
import type { RecordedAction } from '../shared/types';

export async function loadSelection(sessionId: string, actions: RecordedAction[]): Promise<Set<number>> {
  try {
    const res = await send({ type: 'GET_SELECTION', sessionId });
    if (res.ids) return new Set(res.ids);
  } catch {
    /* fallthrough */
  }
  return new Set(actions.map((a) => a.id!));
}

export async function persistSelection(): Promise<void> {
  if (!store.currentId) return;
  try {
    await send({ type: 'SET_SELECTION', sessionId: store.currentId, ids: [...store.selected] });
  } catch {
    /* ignore */
  }
}

/** 采纳外部(DevTools 面板)的勾选变化;返回是否发生变化 */
export function adoptSelection(ids: unknown): boolean {
  if (!Array.isArray(ids)) return false;
  const next = new Set(ids as number[]);
  const same = next.size === store.selected.size && [...next].every((id) => store.selected.has(id));
  if (same) return false;
  store.selected = next;
  return true;
}

export const selectionKey = (sessionId: string): string => `selection:${sessionId}`;
