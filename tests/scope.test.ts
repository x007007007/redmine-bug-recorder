import assert from 'node:assert/strict';
import test from 'node:test';
import { applyScope, DEFAULT_MAX_ACTIONS } from '../manager/range';
import { action, detail, request } from './fixture';

test('不超过 100 步时保留全部', () => {
  const full = detail({
    actions: [action({ id: 1, kind: 'click', url: 'https://app.example.com', ts: 10 })],
    requests: [request({ url: 'https://api.example.com/a', ts: 11 })],
  });
  const scoped = applyScope(full, null, false);
  assert.equal(scoped.scope, null);
  assert.equal(scoped.cache.actions.length, 1);
  assert.equal(scoped.cache.requests.length, 1);
});

test('超过 100 步时保留数组末尾 100 步，并按起点裁事件', () => {
  const actions = Array.from({ length: DEFAULT_MAX_ACTIONS + 5 }, (_, index) =>
    action({ id: index + 1, kind: 'click', url: 'https://app.example.com', ts: 1000 + index })
  );
  const full = detail({
    actions,
    requests: [
      request({ url: 'https://api.example.com/old', ts: actions[0]!.ts }),
      request({ url: 'https://api.example.com/kept', ts: actions[5]!.ts }),
    ],
    notes: [{ sessionId: 's1', ts: actions[4]!.ts, url: 'https://app.example.com', selector: '#a', label: '旧', htmlHint: '', opinion: '丢' }],
  });
  const scoped = applyScope(full, null, false);
  assert.equal(scoped.cache.actions.length, DEFAULT_MAX_ACTIONS);
  assert.equal(scoped.cache.actions[0]!.id, 6);
  assert.equal(scoped.cache.requests.length, 1);
  assert.equal(scoped.cache.requests[0]!.url, 'https://api.example.com/kept');
  assert.equal(scoped.cache.notes.length, 0);
  assert.match(scoped.scope!.label, /最近 100 步/);
});

test('时间选区优先，查看全部时忽略选区', () => {
  const full = detail({
    actions: [
      action({ id: 1, kind: 'click', url: 'https://app.example.com', ts: 10 }),
      action({ id: 2, kind: 'click', url: 'https://app.example.com', ts: 20 }),
      action({ id: 3, kind: 'click', url: 'https://app.example.com', ts: 30 }),
    ],
  });
  const range = { sessionId: 's1', fromTs: 20, toTs: 20 };
  const scoped = applyScope(full, range, false);
  assert.deepEqual(scoped.cache.actions.map((item) => item.id), [2]);
  const all = applyScope(full, range, true);
  assert.equal(all.scope, null);
  assert.equal(all.cache.actions.length, 3);
});
