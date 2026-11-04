import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeImport } from '../shared/import-session';

test('导入导出会话时丢掉占位截图并换成新 id', () => {
  const bundle = normalizeImport(
    {
      session: { id: 'old', startedAt: 1, endedAt: null, status: 'recording', subject: '', issueId: null, issueUrl: null },
      actions: [{ id: 3, sessionId: 'old', kind: 'click', url: 'https://a', ts: 1, screenshot: '<dataURL 截图,略>' }],
    },
    'new'
  );
  assert.equal(bundle.session.id, 'new');
  assert.equal(bundle.session.status, 'stopped');
  assert.equal(bundle.actions[0]!.sessionId, 'new');
  assert.equal('id' in bundle.actions[0]!, false);
  assert.equal(bundle.actions[0]!.screenshot, undefined);
});

test('不是会话 JSON 时拒绝', () => {
  let message = '';
  try {
    normalizeImport({ hello: 1 }, 'new');
  } catch (e) {
    if (e instanceof Error) message = e.message;
  }
  assert.match(message, /会话 JSON/);
});
