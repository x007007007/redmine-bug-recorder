// 会话查询与删除:列表(含计数)、详情、删除会话、按 id 批量删除步骤/请求/Pinia 事件。

import {
  dbAll,
  dbGet,
  dbDelete,
  dbListByIndex,
  dbCountByIndex,
} from '../shared/db';
import type { ChangeNote, LogEntry, PiniaEvent, RecordedAction, RecorderSession, RequestEntry, SessionDetail, SessionSummary } from '../shared/types';

export async function listSessions(): Promise<SessionSummary[]> {
  const sessions = await dbAll<RecorderSession>('sessions');
  sessions.sort((a, b) => b.startedAt - a.startedAt);
  const out: SessionSummary[] = [];
  for (const s of sessions) {
    out.push({
      ...s,
      actionCount: await dbCountByIndex('actions', 'bySession', s.id),
      requestCount: await dbCountByIndex('requests', 'bySession', s.id),
      logCount: await dbCountByIndex('logs', 'bySession', s.id),
      piniaCount: await dbCountByIndex('pinia', 'bySession', s.id),
    });
  }
  return out;
}

export async function getSession(id: string): Promise<SessionDetail> {
  const session = await dbGet<RecorderSession>('sessions', id);
  if (!session) throw new Error('会话不存在');
  const actions = (await dbListByIndex<RecordedAction>('actions', 'bySession', id)).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  const requests = (await dbListByIndex<RequestEntry>('requests', 'bySession', id)).sort((a, b) => a.ts - b.ts);
  const logs = (await dbListByIndex<LogEntry>('logs', 'bySession', id)).sort((a, b) => a.ts - b.ts).slice(-100);
  const pinia = (await dbListByIndex<PiniaEvent>('pinia', 'bySession', id)).sort((a, b) => a.ts - b.ts);
  const notes = (await dbListByIndex<ChangeNote>('notes', 'bySession', id)).sort((a, b) => a.ts - b.ts);
  return { session, actions, requests, logs, pinia, notes };
}

export async function deleteSession(id: string): Promise<{ ok: true }> {
  for (const store of ['actions', 'requests', 'logs', 'pinia', 'notes'] as const) {
    const items = await dbListByIndex<{ id: number }>(store, 'bySession', id);
    for (const item of items) {
      await dbDelete(store, item.id);
    }
  }
  await dbDelete('sessions', id);
  return { ok: true };
}

/** 批量删除(仅当记录确实属于该会话时才删,防误删其他会话数据) */
export async function deleteItems(
  sessionId: string,
  actionIds: number[] = [],
  requestIds: number[] = [],
  piniaIds: number[] = []
): Promise<{ ok: true; removed: number }> {
  const groups: [('actions' | 'requests' | 'pinia'), number[]][] = [
    ['actions', actionIds],
    ['requests', requestIds],
    ['pinia', piniaIds],
  ];
  let removed = 0;
  for (const [storeName, ids] of groups) {
    for (const id of ids) {
      const item = await dbGet<{ id: number; sessionId: string }>(storeName, id);
      if (item && item.sessionId === sessionId) {
        await dbDelete(storeName, id);
        removed += 1;
      }
    }
  }
  return { ok: true, removed };
}
