import assert from 'node:assert/strict';
import test from 'node:test';
import { action, session } from './fixture';
import { buildSubject, clip, describeAction, describeLog, describePiniaEvent, shortUrl } from '../shared/describe';

test('步骤文案覆盖点击、输入、按键和提交', () => {
  assert.equal(describeAction(action({ kind: 'navigate', url: 'https://app.example.com/login', ts: 1 })), '打开页面 https://app.example.com/login');
  assert.equal(describeAction(action({ kind: 'click', url: 'https://app.example.com', ts: 1, label: '登录' })), '点击「登录」');
  assert.equal(
    describeAction(action({ kind: 'input', url: 'https://app.example.com', ts: 1, label: '用户名', inputType: 'keyboard', value: 'demo' })),
    '在「用户名」中输入 "demo"'
  );
  assert.equal(
    describeAction(action({ kind: 'input', url: 'https://app.example.com', ts: 1, label: '记住我', inputType: 'checkbox', value: '选中' })),
    '「记住我」勾选'
  );
  assert.equal(
    describeAction(action({ kind: 'input', url: 'https://app.example.com', ts: 1, label: '记住我', inputType: 'checkbox', value: '取消' })),
    '「记住我」取消勾选'
  );
  assert.equal(
    describeAction(action({ kind: 'keypress', url: 'https://app.example.com', ts: 1, key: 'Enter', label: '密码' })),
    '按下 回车 键(焦点在「密码」)'
  );
  assert.equal(
    describeAction(action({ kind: 'submit', url: 'https://app.example.com', ts: 1, label: '登录表单', value: 'username' })),
    '提交表单「登录表单」(字段: username)'
  );
});

test('截断、短路径和标题', () => {
  assert.equal(clip('abcdef', 3), 'abc…(截断,共 6 字符)');
  assert.equal(clip(null, 4), '');
  assert.equal(shortUrl('https://app.example.com/orders?id=1#hash'), '/orders?id=1');
  assert.equal(shortUrl('not a url'), 'not a url');

  const title = buildSubject(session(), [
    action({ kind: 'navigate', url: 'https://app.example.com/login', ts: 1 }),
    action({ kind: 'click', url: 'https://app.example.com/login', ts: 2, label: '登录' }),
  ]);
  assert.match(title, /^\[Bug Recorder\] app\.example\.com 点击「登录」 @ \d{4}-\d{2}-\d{2} /);
});

test('Pinia 与 Console 文案', () => {
  assert.equal(
    describePiniaEvent({ sessionId: 's1', ts: 1, storeId: 'auth', action: 'login', args: '["demo"]' }),
    '调用 auth.login() 参数 ["demo"]'
  );
  assert.equal(
    describePiniaEvent({ sessionId: 's1', ts: 1, storeId: 'auth', changeType: 'direct', keys: ['token'] }),
    'auth direct 字段 [token]'
  );
  assert.equal(describeLog({ sessionId: 's1', ts: 1, level: 'error', text: 'boom' }), 'Console 错误: boom');
});
