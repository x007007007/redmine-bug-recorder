import assert from 'node:assert/strict';
import test from 'node:test';
import { dataUrlToBytes, listProjects, normalizeBase, testConnection, uploadAttachment } from '../shared/redmine';

test('站点根地址去掉页面路径、查询串，并补上协议', () => {
  assert.equal(normalizeBase(''), '');
  assert.equal(normalizeBase('redmine.example.com/projects/demo/issues/12?tab=1#c'), 'https://redmine.example.com');
  assert.equal(normalizeBase('http://redmine.example.com/redmine/my/account/'), 'http://redmine.example.com/redmine');
  assert.equal(normalizeBase('http://redmine.example.com/issues/8'), 'http://redmine.example.com');
  // /issues/8.json 目前剥不掉，见 docs/设计问题.md DQ-15
  assert.equal(normalizeBase('http://redmine.example.com/issues/8.json'), 'http://redmine.example.com/issues/8.json');
  assert.equal(normalizeBase('https://redmine.example.com/'), 'https://redmine.example.com');
});

test('data URL 转成原始字节', () => {
  assert.deepEqual([...dataUrlToBytes('data:text/plain;base64,QUJD')], [65, 66, 67]);
});

test('Redmine HTTP 回退：401 改走 key，附件 404 改走 /uploads，错误里不出现 Key', async () => {
  const original = globalThis.fetch;
  const calls: { url: string; headerKey: string | null }[] = [];
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, headerKey: headers.get('X-Redmine-API-Key') });
      if (url.includes('/users/current.json') && !url.includes('key=')) {
        return new Response('denied', { status: 401 });
      }
      if (url.includes('/users/current.json')) {
        return Response.json({ user: { login: 'demo', firstname: '测', lastname: '试' } });
      }
      return new Response('missing', { status: 404 });
    };

    const user = await testConnection({ redmineUrl: 'https://redmine.example.com/projects/demo', apiKey: 'secret-key' });
    assert.equal(user.login, 'demo');
    assert.equal(user.name, '测 试');
    assert.equal(calls[0]!.headerKey, 'secret-key');
    assert.equal(calls[0]!.url.includes('key='), false);
    assert.equal(calls[1]!.url.includes('key=secret-key'), true);

    calls.length = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, headerKey: headers.get('X-Redmine-API-Key') });
      if (url.includes('/uploads.json')) return new Response('no', { status: 404 });
      if (url.includes('/uploads?')) return Response.json({ upload: { token: 'tok', id: 4 } });
      return new Response('missing', { status: 404 });
    };
    const uploaded = await uploadAttachment({ redmineUrl: 'https://redmine.example.com', apiKey: 'secret-key' }, 'step-01.jpg', new Uint8Array([1]));
    assert.equal(uploaded?.token, 'tok');
    assert.equal(calls.some((call) => call.url.includes('/uploads.json')), true);
    assert.equal(calls.some((call) => call.url.includes('/uploads?filename=')), true);

    calls.length = 0;
    globalThis.fetch = async (input) => {
      calls.push({ url: String(input), headerKey: null });
      return new Response('missing', { status: 404 });
    };
    await assert.rejects(
      () => testConnection({ redmineUrl: 'https://redmine.example.com', apiKey: 'secret-key' }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.equal(message.includes('secret-key'), false);
        assert.match(message, /404/);
        return true;
      }
    );

    calls.length = 0;
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push({ url, headerKey: null });
      if (url.includes('/users/current.json?include=memberships')) {
        return Response.json({ user: { memberships: [{ project: { id: 9, name: '演示', identifier: 'demo' } }] } });
      }
      return new Response('missing', { status: 404 });
    };
    const projects = await listProjects({ redmineUrl: 'https://redmine.example.com', apiKey: 'secret-key' });
    assert.deepEqual(projects, [{ id: 9, name: '演示', identifier: 'demo' }]);
  } finally {
    globalThis.fetch = original;
  }
});
