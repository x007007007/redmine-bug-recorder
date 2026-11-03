import assert from 'node:assert/strict';
import test from 'node:test';
import { action, request } from './fixture';
import {
  SHOW_ALL_CAPTURE,
  buildPages,
  buildTabLabels,
  computePropsDiffs,
  entryMatchesCapture,
  filterPages,
  ownedBySelection,
  pageUrl,
  sortPages,
} from '../shared/timeline';
import type { LogEntry, PageGroup, TimelineEntry } from '../shared/types';

test('pageUrl 去掉 hash，非法地址原样返回', () => {
  assert.equal(pageUrl('https://app.example.com/app#/orders?x=1'), 'https://app.example.com/app');
  assert.equal(pageUrl('https://app.example.com/orders?x=1'), 'https://app.example.com/orders?x=1');
  assert.equal(pageUrl(':::'), ':::');
});

test('地址变化才新开大步骤，重复跳转不进入页面', () => {
  const pages = buildPages([
    action({ id: 1, kind: 'navigate', url: 'https://app.example.com/login#form', title: '登录', ts: 1000 }),
    action({ id: 2, kind: 'click', url: 'https://app.example.com/login', label: '登录', ts: 1100 }),
    action({ id: 3, kind: 'navigate', url: 'https://app.example.com/login#done', ts: 1200 }),
    action({ id: 4, kind: 'click', url: 'https://app.example.com/orders', label: '订单', ts: 2000 }),
  ]);
  assert.equal(pages.length, 2);
  assert.equal(pages[0]!.orderIndex, 1);
  assert.deepEqual(pages[0]!.actions.map((item) => item.id), [1, 2]);
  assert.deepEqual(pages[1]!.actions.map((item) => item.id), [4]);
});

test('请求按时间窗归页，相同时间的操作排在请求前', () => {
  const pages = buildPages(
    [
      action({ id: 1, kind: 'navigate', url: 'https://app.example.com/a', ts: 1000 }),
      action({ id: 2, kind: 'click', url: 'https://app.example.com/a', ts: 1500 }),
      action({ id: 3, kind: 'click', url: 'https://app.example.com/b', ts: 2000 }),
    ],
    [
      request({ id: 10, url: 'https://api.example.com/early', ts: 500 }),
      request({ id: 11, url: 'https://api.example.com/with-click', ts: 1500, method: 'POST', status: 500 }),
      request({ id: 12, url: 'https://api.example.com/next', ts: 2000 }),
    ]
  );
  const firstTypes = pages[0]!.entries.map((entry) => `${entry.type}:${entry.type === 'request' ? entry.data.id : entry.data.id}`);
  assert.deepEqual(firstTypes, ['request:10', 'action:1', 'action:2', 'request:11']);
  assert.equal(pages[0]!.entries[0]!.ownerStepIdx, -1);
  assert.equal(pages[0]!.entries.find((entry) => entry.type === 'request' && entry.data.id === 11)!.ownerStepIdx, 1);
  assert.equal(pages[1]!.entries.some((entry) => entry.type === 'request' && entry.data.id === 12), true);
});

test('没有步骤时，请求进入伪页面', () => {
  const pages = buildPages([], [request({ url: 'https://api.example.com/health', ts: 10 })]);
  assert.equal(pages.length, 1);
  assert.equal(pages[0]!.pseudo, true);
  assert.equal(pages[0]!.url, '(未记录页面)');
});

test('勾选归属只保留不晚于所选步骤的事件', () => {
  const actions = [
    action({ id: 1, kind: 'click', url: 'https://app.example.com', ts: 100 }),
    action({ id: 2, kind: 'click', url: 'https://app.example.com', ts: 200 }),
  ];
  const items = [{ ts: 50, name: 'before' }, { ts: 100, name: 'on-first' }, { ts: 180, name: 'mid' }, { ts: 200, name: 'on-second' }];
  const kept = ownedBySelection(actions, new Set([2]), items);
  assert.deepEqual(kept.map((item) => item.name), ['on-second']);
});

test('排序只动大步骤，搜索匹配接口路径', () => {
  const pages = buildPages(
    [
      action({ id: 1, kind: 'navigate', url: 'https://app.example.com/a', title: '甲', ts: 1000 }),
      action({ id: 2, kind: 'navigate', url: 'https://app.example.com/b', title: '乙', ts: 2000 }),
    ],
    [request({ url: 'https://api.example.com/orders/9', ts: 2100, method: 'GET', status: 200 })]
  );
  assert.deepEqual(sortPages(pages, 'desc').map((page) => page.orderIndex), [2, 1]);
  assert.equal(sortPages(pages, 'asc')[0]!.entries.length, pages[0]!.entries.length);
  assert.equal(filterPages(pages, 'orders/9').length, 1);
  assert.equal(filterPages(pages, '甲')[0]!.orderIndex, 1);
  assert.equal(filterPages(pages, '   ').length, 2);
});

test('props diff 对比同组件的前后快照，并给标签页编号', () => {
  const actions = [
    action({
      id: 1,
      kind: 'click',
      url: 'https://app.example.com',
      ts: 1,
      tabId: 20,
      vue: { component: 'Form', chain: ['Form'], props: '{"title":""}', piniaChanges: [] },
    }),
    action({
      id: 2,
      kind: 'click',
      url: 'https://app.example.com',
      ts: 2,
      tabId: 21,
      vue: { component: 'Form', chain: ['Form'], props: '{"title":"三体","extra":"1"}', piniaChanges: [] },
    }),
  ];
  const diffs = computePropsDiffs(actions);
  assert.deepEqual(diffs.get(1)!.changes, []);
  assert.deepEqual(diffs.get(2)!.changes, ['title:  → 三体', 'extra: (新增) → 1']);
  assert.equal(buildTabLabels(actions).get(20), 1);
  assert.equal(buildTabLabels(actions).get(21), 2);
});

test('收窄捕获类别后，纯导航步骤隐藏，修改意见仍显示', () => {
  const click: TimelineEntry = {
    type: 'action',
    ts: 1,
    ownerStepIdx: 0,
    data: action({ kind: 'click', url: 'https://app.example.com', ts: 1 }),
  };
  const navigate: TimelineEntry = {
    type: 'action',
    ts: 1,
    ownerStepIdx: 0,
    data: action({ kind: 'navigate', url: 'https://app.example.com', ts: 1 }),
  };
  const note: TimelineEntry = {
    type: 'note',
    ts: 2,
    ownerStepIdx: 0,
    data: { sessionId: 's1', ts: 2, url: 'https://app.example.com', selector: '#a', label: '标题', htmlHint: '', opinion: '改文案' },
  };
  const narrowed = { ...SHOW_ALL_CAPTURE, isClickShown: true, isKeyboardShown: false };
  assert.equal(entryMatchesCapture(click, narrowed), true);
  assert.equal(entryMatchesCapture(navigate, narrowed), false);
  assert.equal(entryMatchesCapture(note, narrowed), true);
  assert.equal(entryMatchesCapture(navigate, SHOW_ALL_CAPTURE), true);
});

test('空伪页面不会留下', () => {
  const pages: PageGroup[] = buildPages([]);
  assert.equal(pages.length, 0);
});

test('Console 条目可进入页面', () => {
  const log: LogEntry = { sessionId: 's1', ts: 1600, level: 'warning', text: 'slow' };
  const pages = buildPages([action({ id: 1, kind: 'click', url: 'https://app.example.com', ts: 1500 })], [], [], [log]);
  assert.equal(pages[0]!.entries.some((entry) => entry.type === 'log'), true);
});
