// 提交页侧的勾选集合读写:与 DevTools 面板经 storage.session 双向同步(缺失=全选)。

import { send } from './api';
import { store } from './store';
import type { RecordedAction } from '../shared/types';

export async function loadSelection(sessionId: string, actions: RecordedAction[]): Promise<Set<number>> {
  try {
    const res = await send({ type: 'GET_SELECTION', sessionId });
    if (res.ids) return new Set(res.ids.filter((id) => typeof id === 'number'));
  } catch {
    /* fallthrough */
  }
  return new Set(actions.map((a) => a.id!));
}

let selectionGate: Promise<void> = Promise.resolve();

export function persistSelection(): void {
  if (!store.currentId) return;
  store.selectionRev += 1;
  const rev = store.selectionRev;
  const sessionId = store.currentId;
  const ids = [...store.selected].filter((id) => typeof id === 'number');
  selectionGate = selectionGate.then(async () => {
    if (rev !== store.selectionRev || sessionId !== store.currentId) return;
    try {
      await send({ type: 'SET_SELECTION', sessionId, ids });
    } catch {
      /* ignore */
    }
  });
}

/** 等当前勾选写完。期间又有新勾选时返回 false,调用方应丢掉过期的读回。 */
export async function selectionStable(rev: number): Promise<boolean> {
  await selectionGate;
  return rev === store.selectionRev;
}

/** 采纳外部(DevTools 面板)的勾选变化;返回是否发生变化 */
export function adoptSelection(ids: unknown): boolean {
  if (!Array.isArray(ids)) return false;
  const next = new Set(ids.filter((id): id is number => typeof id === 'number'));
  const same = next.size === store.selected.size && [...next].every((id) => store.selected.has(id));
  if (same) return false;
  store.selectionRev += 1;
  store.selected = next;
  return true;
}

export const selectionKey = (sessionId: string): string => `selection:${sessionId}`;
