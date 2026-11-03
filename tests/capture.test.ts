import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCapture, shouldRecordRequest } from '../shared/capture';

test('捕获开关只接收布尔值，缺省为全开且仅当前页', () => {
  const flags = normalizeCapture({ isClickEnabled: false, isVueEnabled: 'yes' as unknown as boolean, isRequestPageOnly: false });
  assert.equal(flags.isClickEnabled, false);
  assert.equal(flags.isVueEnabled, true);
  assert.equal(flags.isKeyboardEnabled, true);
  assert.equal(flags.isRequestPageOnly, false);
  assert.equal(normalizeCapture(null).isScreenshotEnabled, true);
});

test('扩展自身、Redmine 和其它标签页的请求不记录', () => {
  const redmine = 'https://redmine.example.com';
  assert.equal(shouldRecordRequest({ tabId: -1, url: 'https://app.example.com/a' }, false, 1, ''), false);
  assert.equal(
    shouldRecordRequest({ tabId: 3, url: 'https://app.example.com/a', initiator: 'chrome-extension://abc/page.js' }, false, 3, ''),
    false
  );
  assert.equal(
    shouldRecordRequest({ tabId: 3, url: 'https://redmine.example.com/issues.json', initiator: 'https://app.example.com' }, false, 3, redmine),
    false
  );
  assert.equal(
    shouldRecordRequest({ tabId: 9, url: 'https://api.example.com/orders', initiator: 'https://app.example.com' }, true, 3, redmine),
    false
  );
  assert.equal(
    shouldRecordRequest({ tabId: 3, url: 'https://api.example.com/orders', initiator: 'https://app.example.com' }, true, 3, redmine),
    true
  );
  assert.equal(
    shouldRecordRequest({ tabId: 9, url: 'https://api.example.com/orders', initiator: 'https://app.example.com' }, false, null, ''),
    true
  );
});
