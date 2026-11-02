// 会话查询与删除:列表(含计数)、详情、删除会话、按 id 批量删除步骤/请求/Pinia 事件。

import {
  dbAll,
  dbGet,
  dbDelete,
  dbListByIndex,
  dbCountByIndex,
  clearSessionData,
} from '../shared/db.js';

export async function listSessions() {
  const sessions = await dbAll('sessions');
  sessions.sort((a, b) => b.startedAt - a.startedAt);
  const out = [];
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

export async function getSession(id) {
  const session = await dbGet('sessions', id);
  if (!session) throw new Error('会话不存在');
  const actions = (await dbListByIndex('actions', 'bySession', id)).sort((a, b) => a.id - b.id);
  const requests = (await dbListByIndex('requests', 'bySession', id)).sort((a, b) => a.ts - b.ts);
  const logs = (await dbListByIndex('logs', 'bySession', id)).sort((a, b) => a.ts - b.ts).slice(-100);
  const pinia = (await dbListByIndex('pinia', 'bySession', id)).sort((a, b) => a.ts - b.ts);
  return { session, actions, requests, logs, pinia };
}

export async function deleteSession(id) {
  await clearSessionData(id);
  return { ok: true };
}

// 批量删除(仅当记录确实属于该会话时才删,防误删其他会话数据)
export async function deleteItems(sessionId, actionIds = [], requestIds = [], piniaIds = []) {
  const groups = [
    ['actions', actionIds],
    ['requests', requestIds],
    ['pinia', piniaIds],
  ];
  let removed = 0;
  for (const [storeName, ids] of groups) {
    for (const id of ids) {
      const item = await dbGet(storeName, id);
      if (item && item.sessionId === sessionId) {
        await dbDelete(storeName, id);
        removed += 1;
      }
    }
  }
  return { ok: true, removed };
}
