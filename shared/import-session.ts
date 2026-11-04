// 把「导出 JSON」读回成一条新会话。截图若已被导出成占位文字,则丢掉。

import { t } from './i18n';
import type { ChangeNote, LogEntry, PiniaEvent, RecordedAction, RecorderSession, RequestEntry, SessionStatus } from './types';

export interface ImportBundle {
  session: RecorderSession;
  actions: RecordedAction[];
  requests: RequestEntry[];
  logs: LogEntry[];
  pinia: PiniaEvent[];
  notes: ChangeNote[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeImport(raw: unknown, id: string): ImportBundle {
  assert(isRecord(raw) && isRecord(raw.session) && typeof raw.session.startedAt === 'number', t('importBad'));
  const status = sessionStatus(raw.session.status);
  const session: RecorderSession = {
    ...(raw.session as unknown as RecorderSession),
    id,
    status: status === 'recording' ? 'stopped' : status,
  };
  return {
    session,
    actions: rows(raw.actions).map((row) => cleanAction(row, id)),
    requests: rows(raw.requests).map((row) => cleanRow<RequestEntry>(row, id)),
    logs: rows(raw.logs).map((row) => cleanRow<LogEntry>(row, id)),
    pinia: rows(raw.pinia).map((row) => cleanRow<PiniaEvent>(row, id)),
    notes: rows(raw.notes).map((row) => cleanRow<ChangeNote>(row, id)),
  };
}

function cleanAction(row: Record<string, unknown>, sessionId: string): RecordedAction {
  const next = cleanRow<RecordedAction>(row, sessionId);
  if (typeof next.screenshot === 'string' && !next.screenshot.startsWith('data:')) delete next.screenshot;
  return next;
}

function cleanRow<T>(row: Record<string, unknown>, sessionId: string): T {
  const next: Record<string, unknown> = { ...row, sessionId };
  delete next.id;
  return next as T;
}

function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function sessionStatus(value: unknown): SessionStatus {
  if (value === 'recording' || value === 'stopped' || value === 'submitted') return value;
  return 'stopped';
}
