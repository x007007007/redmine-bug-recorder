import assert from 'node:assert/strict';
import test from 'node:test';
import { esc } from '../manager/dom';
import { truncate } from '../content/dom-meta';
import { safeStringify, serializeProps } from '../content/probe-serialize';

test('序列化有深度和长度上限，函数与错误不展开', () => {
  assert.equal(safeStringify(undefined), 'undefined');
  assert.equal(safeStringify('hello'), '"hello"');
  assert.match(safeStringify(() => 1), /^\[fn /);
  assert.match(safeStringify(new Error('boom')), /\[Error\] boom/);
  const nested = { a: { b: { c: { d: { e: 1 } } } } };
  assert.match(safeStringify(nested), /\[…\]/);
  const long = 'x'.repeat(250);
  assert.equal(safeStringify(long).includes('…'), true);
  const list = Array.from({ length: 21 }, (_, index) => index);
  assert.match(safeStringify(list), /共21项/);
});

test('循环引用不会撑爆调用栈', () => {
  const box: { self?: unknown } = {};
  box.self = box;
  const text = safeStringify(box);
  assert.equal(text.length > 0, true);
  assert.equal(text.includes('[序列化失败]') || text.includes('[…]'), true);
});

test('Vue3 props 收成有界 JSON，空 props 返回空', () => {
  assert.equal(serializeProps(null), null);
  assert.equal(serializeProps({ props: {} } as never), null);
  const json = serializeProps({ props: { title: '三体', count: 2 } } as never);
  assert.equal(json?.includes('"title"'), true);
  assert.equal(json?.includes('三体'), true);
});

test('界面转义和值截断', () => {
  assert.equal(esc(`a&b<c>"'`), 'a&#38;b&#60;c&#62;&#34;&#39;');
  assert.match(truncate('y'.repeat(20), 4), /^yyyy…\(20字符\)$/);
});
