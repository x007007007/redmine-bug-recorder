import type { RecordedAction, RecorderSession, RequestEntry, SessionDetail } from '../shared/types';

export function action(over: Partial<RecordedAction> & Pick<RecordedAction, 'ts' | 'kind' | 'url'>): RecordedAction {
  return { sessionId: 's1', ...over };
}

export function session(over: Partial<RecorderSession> = {}): RecorderSession {
  return {
    id: 's1',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_100_000,
    status: 'stopped',
    subject: '',
    issueId: null,
    issueUrl: null,
    ...over,
  };
}

export function detail(over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    session: session(),
    actions: [],
    requests: [],
    logs: [],
    pinia: [],
    notes: [],
    ...over,
  };
}

export function request(over: Partial<RequestEntry> & Pick<RequestEntry, 'ts' | 'url'>): RequestEntry {
  return { sessionId: 's1', method: 'GET', ...over };
}
