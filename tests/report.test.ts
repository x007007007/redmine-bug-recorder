import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCsv } from '../manager/export-csv';
import { buildDescription } from '../shared/report';
import { planShotUploads } from '../shared/shots';
import { action, detail, request, session } from './fixture';

const started = 1_700_000_000_000;

function sampleActions() {
  return [
    action({
      id: 1,
      kind: 'navigate',
      url: 'https://app.example.com/login',
      title: '登录',
      ts: started,
      screenshot: 'data:image/jpeg;base64,QQ==',
    }),
    action({
      id: 2,
      kind: 'click',
      url: 'https://app.example.com/login',
      title: '登录',
      ts: started + 1000,
      label: '登录',
      selector: 'button#login',
      screenshot: 'data:image/jpeg;base64,QQ==',
      point: { x: 8, y: 9 },
      viewport: { w: 100, h: 80 },
      vue: { component: 'LoginForm', chain: ['App', 'LoginForm'], props: '{"loading":"false"}', piniaChanges: [] },
    }),
  ];
}

test('截图计划：无限量时全部保留，有坐标的用 png，限量取末尾', () => {
  const actions = sampleActions();
  const plan = planShotUploads(actions);
  assert.deepEqual(
    plan.map((item) => item.filename),
    ['step-01.jpg', 'step-02.png']
  );
  const limited = planShotUploads(
    [
      ...actions,
      action({ id: 3, kind: 'click', url: 'https://app.example.com/login', ts: started + 2000, screenshot: 'data:image/jpeg;base64,QQ==' }),
    ],
    1
  );
  assert.deepEqual(limited.map((item) => [item.actionId, item.filename]), [[3, 'step-01.jpg']]);
});

test('描述按正序写出步骤、失败接口、修改意见和环境', () => {
  const text = buildDescription(
    session({ startedAt: started }),
    sampleActions(),
    [request({ url: 'https://api.example.com/login', ts: started + 1000, method: 'POST', status: 500, durationMs: 342, requestBody: '{"n":1}' })],
    [
      { sessionId: 's1', ts: started + 1100, level: 'info', text: 'ignore-me' },
      { sessionId: 's1', ts: started + 1200, level: 'error', text: 'boom' },
    ],
    { userAgent: 'TestAgent', lastUrl: 'https://app.example.com/login' },
    {
      notes: [
        {
          sessionId: 's1',
          ts: started + 1300,
          url: 'https://app.example.com/login',
          title: '登录',
          selector: 'h1',
          label: '标题',
          htmlHint: '<h1>',
          opinion: '改成「欢迎」',
        },
      ],
    }
  );
  assert.match(text, /### 大步骤 1 · 页面 https:\/\/app\.example\.com\/login\(登录\)/);
  assert.match(text, /整页截图: step-01\.jpg/);
  assert.match(text, /1\. 点击「登录」/);
  assert.match(text, /截图: step-02\.png/);
  assert.match(text, /Vue 组件: LoginForm\(App > LoginForm\)/);
  assert.match(text, /API `POST \/login` → \*\*500\*\* · 342ms ⚠️/);
  assert.match(text, /请求体/);
  assert.match(text, /## 修改意见/);
  assert.match(text, /改为: 改成「欢迎」/);
  assert.match(text, /Console 信息: ignore-me/);
  assert.match(text, /## Console 错误 \/ 警告/);
  assert.match(text, /\[error\] boom/);
  assert.equal(text.includes('[info]'), false);
  assert.match(text, /User-Agent: TestAgent/);
});

test('没有修改意见时写明，Console 只保留最近 50 条错误或警告', () => {
  const logs = Array.from({ length: 51 }, (_, index) => ({
    sessionId: 's1',
    ts: started + index,
    level: 'warning' as const,
    text: `w-${index}`,
  }));
  const text = buildDescription(session(), [], [], logs);
  assert.match(text, /本次没有修改意见/);
  assert.equal(text.includes('w-0'), false);
  assert.match(text, /w-50/);
});

test('CSV 转义逗号和引号，并只保留截图 base64 正文', () => {
  const csv = buildCsv(
    detail({
      actions: [
        action({
          id: 7,
          kind: 'click',
          url: 'https://app.example.com/a',
          ts: started,
          label: 'a,b"c',
          screenshot: 'data:image/jpeg;base64,QUJD',
        }),
      ],
    })
  );
  assert.match(csv, /^时间,大步骤,类型,内容,/);
  assert.match(csv, /"点击「a,b""c」"/);
  assert.match(csv, /,QUJD\r?$/m);
  assert.equal(csv.includes('data:image'), false);
});
