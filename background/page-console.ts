// 页面主世界挂钩送来的 console / 未捕获异常。Firefox 与 Chrome 共用，不依赖 debugger。

import { dbAdd, dbCountByIndex } from '../shared/db';
import { state, mem, notifySessionUpdated } from './state';
import type { LogEntry } from '../shared/types';

const MAX_LOGS_PER_SESSION = 300;

const PAGE_LEVEL: Record<string, LogEntry['level']> = {
  log: 'log',
  info: 'info',
  warning: 'warning',
  error: 'error',
};

export function recordPageConsole(level: string, text: string): { recorded: boolean } {
  if (!state.recording || !mem.capture.isConsoleEnabled || !state.sessionId) return { recorded: false };
  const mapped = PAGE_LEVEL[level];
  if (!mapped || !text) return { recorded: false };
  void addLog(state.sessionId, mapped, text);
  return { recorded: true };
}

async function addLog(sessionId: string | null, level: LogEntry['level'], text: string): Promise<void> {
  if (!sessionId) return;
  const count = await dbCountByIndex('logs', 'bySession', sessionId);
  if (count >= MAX_LOGS_PER_SESSION) return;
  await dbAdd<LogEntry>('logs', { sessionId, ts: Date.now(), level, text: text.slice(0, 500) }).catch(() => {});
  notifySessionUpdated();
}
