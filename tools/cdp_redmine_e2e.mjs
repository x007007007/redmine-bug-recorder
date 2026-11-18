#!/usr/bin/env node
// 端到端测试:用真实 Redmine(本地 Docker,默认 http://127.0.0.1:13000)走完整提交流程。
// 前置: npm run build → node tools/dev-launch.mjs chrome --no-build --cdp-port=9223
//        python3 demo/server.py  → python3 demo/server.py (8123) → service-redminbugrecorder/init.sh && node service-redminbugrecorder/setup.mjs
// 用法: node tools/cdp_redmine_e2e.mjs <cdp-port> <extension-id> [ak] [base]
// AK 默认从 service-redminbugrecorder/.env 读。
// 流程: 配置页填真实 Redmine → 连接测试 → 列项目(含层级子项目) → tracker/优先级
//       → 录制 demo 操作 → 提交 bug(带截图) → 从 Redmine API 验证 issue/附件
//       → 手填项目标识(demo-backend)再提交一条 → 再次验证。
import fs from 'node:fs';
import path from 'node:path';

const [port, extId, akArg, baseArg] = process.argv.slice(2);
if (!port || !extId) {
  console.error('usage: node tools/cdp_redmine_e2e.mjs <cdp-port> <extension-id> [ak] [base]');
  process.exit(2);
}
const REPO = process.cwd();
const BASE = baseArg || 'http://127.0.0.1:13000';
const DEMO = 'http://127.0.0.1:8123';

let AK = akArg;
if (!AK) {
  const envPath = path.join(REPO, 'service-redminbugrecorder', '.env');
  for (const line of fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split('\n') : []) {
    const m = line.match(/^REDMINE_AK=(.+?)\s*$/);
    if (m) AK = m[1];
  }
}
if (!AK) {
  console.error('✗ 缺少 API Key:第三个参数或 service-redminbugrecorder/.env');
  process.exit(2);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(`${msg.error.message} ${msg.error.data || ''}`)) : resolve(msg.result);
      }
    });
  }
  static async connect(port_) {
    const ver = await (await fetch(`http://127.0.0.1:${port_}/json/version`)).json();
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    return new Cdp(ws);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 30000);
    });
  }
}

const cdp = await Cdp.connect(port);
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(url) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  return { targetId, sessionId };
}

async function evalJs(sessionId, expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (res.exceptionDetails) {
    throw new Error('页面 JS 异常: ' + JSON.stringify(res.exceptionDetails.exception?.description || res.exceptionDetails.text));
  }
  return res.result.value;
}

async function waitFor(sessionId, expr, label, timeoutMs = 15000) {
  const start = Date.now();
  let lastVal;
  while (Date.now() - start < timeoutMs) {
    const v = await evalJs(sessionId, expr).catch((e) => ({ evalError: String(e.message).slice(0, 150) }));
    if (v === true) return true;
    if (v !== false) lastVal = v;
    await sleep(250);
  }
  throw new Error(`等待超时: ${label}(最后观测: ${JSON.stringify(lastVal)})`);
}

/** 按可见文本设置 select 的值 */
const setSelectByText = (id, text) => `(() => {
  const sel = document.getElementById(${JSON.stringify(id)});
  const opt = [...sel.options].find(o => o.textContent.trim().includes(${JSON.stringify(text)}));
  if (!opt) return 'NOT_FOUND:' + [...sel.options].map(o => o.textContent.trim()).join('|');
  sel.value = opt.value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return opt.value;
})()`;

const redmineApi = async (p) => {
  const res = await fetch(BASE + p, { headers: { 'X-Redmine-API-Key': AK, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} GET ${p}`);
  return res.json();
};

/* 1. 配置页:填真实 Redmine 地址 + AK,保存,连接测试 */
const EXT_BASE = `chrome-extension://${extId}`;
let options;
try {
  options = await newPage(`${EXT_BASE}/options/options.html`);
  await waitFor(options.sessionId, `window.__bugrecOptReady === true`, '配置页初始化完成');
  await evalJs(
    options.sessionId,
    `(() => {
      document.getElementById('setUrl').value = ${JSON.stringify(BASE)};
      document.getElementById('setKey').value = ${JSON.stringify(AK)};
      const locale = document.getElementById('setLocale');
      if (locale) locale.value = 'zh_CN';
      document.getElementById('btnSaveSettings').click();
      return true;
    })()`
  );
  await waitFor(
    options.sessionId,
    `(async () => {
      const s = ((await chrome.storage.local.get('recorderSettings')).recorderSettings) || {};
      return s.redmineUrl === ${JSON.stringify(BASE)} && s.apiKey === ${JSON.stringify(AK)};
    })()`,
    '设置保存落盘'
  );
  await waitFor(options.sessionId, `window.__bugrecOptReady === true`, '配置页重载完成', 10000);
  await evalJs(options.sessionId, `document.getElementById('btnTest').click(); true`);
  await waitFor(
    options.sessionId,
    `/连接成功/.test(document.getElementById('testResult').textContent)`,
    '连接测试(真实 Redmine /users/current.json)',
    15000
  );
  ok('连接测试通过(/users/current.json + AK)', true);
} catch (e) {
  ok('配置页填真实 Redmine 并连接测试', false, e.message);
  console.log(JSON.stringify(results, null, 2));
  process.exit(1);
}

/* 2. 管理页:重载后载入项目列表(含层级子项目) */
const manager = await newPage(`${EXT_BASE}/manager/manager.html`);
await waitFor(manager.sessionId, `window.__bugrecMgrReady === true`, '管理页初始化完成');
await evalJs(manager.sessionId, `document.getElementById('btnLoadProjects').click(); true`);
await waitFor(manager.sessionId, `document.getElementById('bugProject').options.length > 2`, '载入项目列表');
const projectOpts = await evalJs(
  manager.sessionId,
  `[...document.getElementById('bugProject').options].map(o => ({ v: o.value, t: o.textContent.trim() }))`
);
const pickProject = (text) => projectOpts.find((o) => o.t.includes(text));
ok(
  '项目列表含层级项目(演示系统/前端模块/后端模块/移动端)',
  ['演示系统', '前端模块', '后端模块', '移动端'].every((n) => projectOpts.some((o) => o.t.includes(n))),
  projectOpts.map((o) => o.t).join(' | ')
);
ok(
  '子项目在下拉中按层级缩进展示(└ 前缀,父项目不缩进)',
  ['前端模块', '后端模块', '移动端'].every((n) => projectOpts.some((o) => o.t.includes('└') && o.t.includes(n))) &&
    !projectOpts.some((o) => o.t.includes('└') && o.t.includes('演示系统')),
  projectOpts.map((o) => o.t).join(' | ')
);

/* 3. tracker / 优先级下拉(真实 Redmine 默认数据) */
await sleep(500); // settings-ui init 的 LIST_TRACKERS/LIST_PRIORITIES 异步落下拉框
const trackerOpts = await evalJs(
  manager.sessionId,
  `[...document.getElementById('bugTracker').options].map(o => o.textContent.trim())`
);
ok('跟踪标签下拉来自真实 Redmine(错误/功能/支持)', ['错误', '功能', '支持'].every((n) => trackerOpts.some((t) => t.includes(n))), trackerOpts.join(' | '));
const prioOpts = await evalJs(
  manager.sessionId,
  `[...document.getElementById('bugPriority').options].map(o => o.textContent.trim())`
);
ok('优先级下拉来自真实 Redmine(普通/高)', prioOpts.some((t) => t.includes('普通')) && prioOpts.some((t) => t.includes('高')), prioOpts.join(' | '));

/* 4. 开始录制 + demo 页操作(登录/加书/500) */
await evalJs(manager.sessionId, `document.getElementById('btnToggleRec').click(); true`);
await waitFor(manager.sessionId, `document.getElementById('recText').textContent === '录制中'`, '开始录制');
ok('开始录制', true);

const demo = await newPage(`${DEMO}/`);
await waitFor(demo.sessionId, `!!document.getElementById('btnLogin')`, '演示页加载');
const typeInto = async (id, value) => {
  await evalJs(
    demo.sessionId,
    `(() => {
      const el = document.getElementById(${JSON.stringify(id)});
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`
  );
  await sleep(950);
};
const click = async (id) => {
  await evalJs(demo.sessionId, `document.getElementById(${JSON.stringify(id)}).click(); true`);
  await sleep(300);
};
await typeInto('username', 'demo');
await typeInto('password', 'demo123');
await click('btnLogin');
await waitFor(demo.sessionId, `!document.getElementById('appBox').classList.contains('hidden')`, '登录成功');
ok('demo 页:输入+登录', true);
await typeInto('bookTitle', '银河系漫游指南');
await click('btnAdd');
await click('btnFail');
await waitFor(demo.sessionId, `/服务器报错/.test(document.getElementById('msg').textContent)`, '触发 500');
ok('demo 页:加书 + 触发 500 错误', true);

/* 5. 回管理页选会话,提交到真实 Redmine(子项目 + 错误 tracker + 高优先级 + 3 张截图) */
await sleep(1800); // 等截图管线
await evalJs(manager.sessionId, `document.getElementById('btnRefresh').click(); true`);
await waitFor(manager.sessionId, `document.querySelector('.session') !== null`, '会话出现');
await evalJs(manager.sessionId, `document.querySelector('.session').click(); true`);
await waitFor(manager.sessionId, `!document.getElementById('sessionDetail').hidden`, '会话详情渲染');

const projFront = pickProject('前端模块');
if (!projFront) throw new Error('项目下拉里找不到「前端模块」');
const setProject = await evalJs(manager.sessionId, `(() => { document.getElementById('bugProject').value = ${JSON.stringify(projFront.v)}; return true; })()`);
const setTracker = await evalJs(manager.sessionId, setSelectByText('bugTracker', '错误'));
const setPriority = await evalJs(manager.sessionId, setSelectByText('bugPriority', '高'));
ok('选择项目/跟踪标签/优先级', setProject === true && !String(setTracker).startsWith('NOT_FOUND') && !String(setPriority).startsWith('NOT_FOUND'), `tracker=${setTracker} priority=${setPriority}`);

await evalJs(manager.sessionId, `document.getElementById('bugSubject').value = '【E2E】真实 Redmine 提交测试(子项目+tracker+附件)'; true`);
await evalJs(manager.sessionId, `document.getElementById('bugAttach').checked = true; true`);
await evalJs(manager.sessionId, `document.getElementById('bugShotMax').value = '3'; true`);
await evalJs(manager.sessionId, `document.getElementById('bugForm').requestSubmit(); true`);
try {
  await waitFor(
    manager.sessionId,
    `/已创建/.test(document.getElementById('submitResult').textContent)`,
    '提交成功(真实 Redmine)',
    45000
  );
  ok('提交 issue(uploads + issues.json,截图限量 3)', true, (await evalJs(manager.sessionId, `document.getElementById('submitResult').textContent`)).trim());
} catch (e) {
  const errText = await evalJs(manager.sessionId, `document.getElementById('err').textContent || document.getElementById('submitResult').textContent || '(无错误)'`);
  ok('提交 issue(uploads + issues.json)', false, e.message + ' / 页面: ' + errText);
}

/* 6. 从 Redmine API 侧验证 issue 与附件 */
const latest = await redmineApi('/issues.json?sort=id:desc&limit=1');
const issue = (latest.issues || [])[0];
const descOk = issue && typeof issue.description === 'string' && issue.description.includes('银河系漫游指南');
const issueDetail = issue ? await redmineApi(`/issues/${issue.id}.json?include=attachments`) : null;
const atts = issueDetail ? issueDetail.issue.attachments || [] : [];
ok(
  'Redmine 侧验证:项目/跟踪标签/优先级/描述正确',
  !!issue &&
    issue.project && issue.project.name === '前端模块' &&
    issue.tracker && issue.tracker.name === '错误' &&
    (issue.priority || {}).name === '高' &&
    descOk,
  issue ? `#${issue.id} project=${issue.project && issue.project.name} tracker=${issue.tracker && issue.tracker.name} priority=${issue.priority && issue.priority.name} 描述${(issue.description || '').length}字` : '无 issue'
);
ok('附件已上传(截图 3 张)', atts.length === 3, `附件 ${atts.length} 个: ${atts.map((a) => a.filename).join(', ')}`);

/* 7. 手填项目标识路径:demo-backend 再提交一条 */
const firstSubmitText = await evalJs(manager.sessionId, `document.getElementById('submitResult').textContent`);
await evalJs(manager.sessionId, `document.getElementById('bugProjectManual').value = 'demo-backend'; true`);
await evalJs(manager.sessionId, `document.getElementById('bugSubject').value = '【E2E】手填项目标识提交测试'; true`);
await evalJs(manager.sessionId, `document.getElementById('bugAttachCsv').checked = true; true`);
await evalJs(manager.sessionId, `document.getElementById('bugForm').requestSubmit(); true`);
let manualOk = true;
try {
  await waitFor(
    manager.sessionId,
    `(() => {
      const r = document.getElementById('submitResult').textContent;
      return /已创建/.test(r) && r !== ${JSON.stringify(firstSubmitText)};
    })()`,
    '手填标识提交成功',
    45000
  );
} catch (e) {
  manualOk = false;
}
const second = await redmineApi('/issues.json?sort=id:desc&limit=2');
const secondIssue = (second.issues || []).find((i) => i.subject && i.subject.includes('手填项目标识'));
ok(
  '手填项目标识(demo-backend)提交成功',
  manualOk && !!secondIssue && secondIssue.project && secondIssue.project.name === '后端模块',
  secondIssue ? `#${secondIssue.id} project=${secondIssue.project && secondIssue.project.name}` : '未找到'
);
const csvAtt = secondIssue ? (await redmineApi(`/issues/${secondIssue.id}.json?include=attachments`)).issue.attachments || [] : [];
ok('CSV 附件已上传', csvAtt.some((a) => String(a.filename).endsWith('.csv')), csvAtt.map((a) => a.filename).join(', '));

console.log('E2E_DONE');
console.log(JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass);
if (issue) console.log(`#1 issue: ${BASE}/issues/${issue.id}`);
if (secondIssue) console.log(`#2 issue: ${BASE}/issues/${secondIssue.id}`);
process.exit(failed.length ? 1 : 0);
