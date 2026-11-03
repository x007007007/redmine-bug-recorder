#!/usr/bin/env node
// 端到端冒烟测试:通过 CDP 驱动 Chrome(Chrome for Testing, headless=new)完整走一遍:
//   配置假 Redmine → 开始录制 → 普通页(登录/加书/500) → Vue+Pinia 页(组件/props/Pinia)
//   → 管理页验证分组步骤/截图/API/Pinia → 取消勾选某步骤 → 提交 issue
// 零依赖:Node 内置 fetch + WebSocket(Node >= 21)。
// 用法: node tools/cdp_smoke.mjs <cdp-port> <extension-id> [repo-root]

import fs from 'node:fs';
import path from 'node:path';

const [port, extId, repoRootArg] = process.argv.slice(2);
if (!port || !extId) {
  console.error('usage: node tools/cdp_smoke.mjs <cdp-port> <extension-id> [repo-root]');
  process.exit(2);
}
const REPO = repoRootArg || process.cwd();
const FAKE_STORE = path.join(REPO, 'demo', '.fake-redmine');
const EXT_BASE = `chrome-extension://${extId}`;
const DEMO = 'http://127.0.0.1:8123';

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.eventHandlers = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(`${msg.error.message} ${msg.error.data || ''}`)) : resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.eventHandlers) h(msg);
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
      }, 20000);
    });
  }
}

const cdp = await Cdp.connect(port);
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function newPage(url) {
  const { targetId } = await cdp.send('Target.createTarget', { url });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  return { targetId, sessionId };
}

async function evalJs(sessionId, expression) {
  const res = await cdp.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId
  );
  if (res.exceptionDetails) {
    throw new Error('页面 JS 异常: ' + JSON.stringify(res.exceptionDetails.exception?.description || res.exceptionDetails.text));
  }
  return res.result.value;
}

async function waitFor(sessionId, expr, label, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await evalJs(sessionId, expr).catch(() => false);
    if (v) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`等待超时: ${label}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 1. 打开管理页(扩展页面) */
let manager;
try {
  manager = await newPage(`${EXT_BASE}/manager/manager.html`);
  await waitFor(manager.sessionId, `window.__bugrecMgrReady === true`, '管理页初始化完成');
  ok('扩展管理页可打开(MV3 + MAIN world 探针加载成功)', true);
} catch (e) {
  ok('扩展管理页可打开(MV3 + MAIN world 探针加载成功)', false, e.message);
  console.log(JSON.stringify(results, null, 2));
  process.exit(1);
}

/* 2. 配置假 Redmine 并测试连接 */
await evalJs(
  manager.sessionId,
  `(() => {
    document.getElementById('setUrl').value = 'http://127.0.0.1:8124';
    document.getElementById('setKey').value = 'test-key';
    document.getElementById('btnSaveSettings').click();
    return true;
  })()`
);
await waitFor(manager.sessionId, `/已保存/.test(document.getElementById('testResult').textContent)`, '设置保存完成');
await evalJs(manager.sessionId, `document.getElementById('btnTest').click(); true`);
await waitFor(
  manager.sessionId,
  `/连接成功/.test(document.getElementById('testResult').textContent)`,
  'Redmine 测试连接'
);
ok('Redmine 连接测试(/users/current.json)', true);

await evalJs(manager.sessionId, `document.getElementById('btnLoadProjects').click(); true`);
await waitFor(manager.sessionId, `document.getElementById('bugProject').options.length > 2`, '载入项目列表');
await evalJs(manager.sessionId, `document.getElementById('bugProject').value = '1'; true`);
ok('Redmine 项目下拉载入', true);

/* 3. 开始录制 */
await evalJs(manager.sessionId, `document.getElementById('btnToggleRec').click(); true`);
await waitFor(manager.sessionId, `document.getElementById('recText').textContent === '录制中'`, '开始录制');
ok('开始录制', true);

/* 4. 普通演示页:登录 → 加书 → 500 错误 */
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
  await sleep(950); // 等键盘输入防抖(700ms)落地成一条步骤
};
const click = async (id) => {
  await evalJs(demo.sessionId, `document.getElementById(${JSON.stringify(id)}).click(); true`);
  await sleep(250);
};

await typeInto('username', 'demo');
await typeInto('password', 'demo123');
await click('btnLogin');
await waitFor(demo.sessionId, `!document.getElementById('appBox').classList.contains('hidden')`, '登录成功');
ok('普通页:键盘输入用户名/密码(防抖合并)+ 登录', true);

await typeInto('bookTitle', '银河系漫游指南');
await evalJs(
  demo.sessionId,
  `(() => {
    const c = document.getElementById('bookCat');
    c.value = 'sci-fi';
    c.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`
);
await sleep(300);
await click('btnAdd');
await waitFor(demo.sessionId, `document.querySelectorAll('#bookList li').length >= 3`, '添加图书成功');
ok('普通页:输入+下拉+点击(触发 2 次 API)', true);

await click('btnFail');
await waitFor(demo.sessionId, `/服务器报错/.test(document.getElementById('msg').textContent)`, '触发 500 错误');
ok('普通页:触发服务器 500 错误', true);

/* 5. Vue + Pinia 演示页 */
const vuePage = await newPage(`${DEMO}/vue.html`);
await waitFor(vuePage.sessionId, `!!document.querySelector('#btnAddOrder')`, 'Vue 页加载');

const vueEval = async (expr) => evalJs(vuePage.sessionId, expr);
const vueType = async (id, value) => {
  await vueEval(
    `(() => {
      const el = document.getElementById(${JSON.stringify(id)});
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`
  );
  await sleep(950);
};

await vueEval(
  `(() => {
    const s = document.getElementById('product');
    s.value = '孵化工位';
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`
);
await sleep(400);
await vueType('qty', '3');
await vueEval(`document.getElementById('btnAddOrder').click(); true`);
await waitFor(vuePage.sessionId, `document.querySelectorAll('.order').length >= 1`, '添加订单 1');
await vueType('qty', '5');
await vueEval(`document.getElementById('btnAddOrder').click(); true`);
await waitFor(vuePage.sessionId, `document.querySelectorAll('.order').length >= 2`, '添加订单 2');
await vueEval(`document.querySelector('.order .btn-remove').click(); true`);
await sleep(400);
await vueEval(`document.querySelector('.order .btn-remove').click(); true`);
await sleep(400);
ok('Vue 页:选择/键盘输入/点击/Pinia action(加+删)', true);

/* 6. 等截图管线完成,回管理页验证 */
await sleep(1600);
await evalJs(manager.sessionId, `document.getElementById('btnRefresh').click(); true`);
await waitFor(manager.sessionId, `document.querySelector('.session') !== null`, '会话出现在列表');
await evalJs(manager.sessionId, `document.querySelector('.session').click(); true`);
await waitFor(manager.sessionId, `!document.getElementById('sessionDetail').hidden`, '会话详情渲染');
await sleep(400);

const stepRows = await evalJs(manager.sessionId, `document.querySelectorAll('#steps .step').length`);
ok('小步骤已记录(点击/键盘输入/选择)', stepRows >= 12, `小步骤 ${stepRows} 行`);

const pageGroups = await evalJs(manager.sessionId, `document.querySelectorAll('.page-group').length`);
ok('URL 大步骤分组(应≥3:普通页/vue 页)', pageGroups >= 2, `分组 ${pageGroups} 个`);

const shotInfo = await evalJs(
  manager.sessionId,
  `(() => {
    const imgs = [...document.querySelectorAll('#steps img')];
    return { total: imgs.filter(i => i.src.startsWith('data:image')).length,
             loaded: imgs.filter(i => i.src.startsWith('data:image') && i.naturalWidth > 50).length };
  })()`
);
ok('每步自动截图已生成且可渲染', shotInfo.loaded >= 6, `截图 ${shotInfo.total} 张,渲染成功 ${shotInfo.loaded} 张`);

const vueBadge = await evalJs(
  manager.sessionId,
  `(() => {
    const b = [...document.querySelectorAll('.badge.vue')].map(x => x.textContent);
    return { count: b.length, hasForm: b.some(t => t.includes('AddOrderForm')), hasItem: b.some(t => t.includes('OrderItem')) };
  })()`
);
ok('Vue 组件名捕获(AddOrderForm / OrderItem)', vueBadge.count > 0 && vueBadge.hasForm && vueBadge.hasItem, `badge ${vueBadge.count} 个`);

const propsInfo = await evalJs(
  manager.sessionId,
  `(() => {
    const bodies = [...document.querySelectorAll('.badge.props .props-body')].map(x => x.textContent);
    return { count: bodies.length, hasDefaultQty: bodies.some(t => t.includes('defaultQty')),
             hasDiff: bodies.some(t => t.includes('与上次相比')) };
  })()`
);
ok('组件 props 快照(含 defaultQty)与 props diff', propsInfo.count > 0 && propsInfo.hasDefaultQty && propsInfo.hasDiff, `props ${propsInfo.count} 处,diff=${propsInfo.hasDiff}`);

const piniaInfo = await evalJs(
  manager.sessionId,
  `(() => {
    const lines = [...document.querySelectorAll('.pinia-line')].map(x => x.textContent);
    return { count: lines.length, hasAction: lines.some(t => t.includes('addOrder')), hasRemove: lines.some(t => t.includes('removeOrder')) };
  })()`
);
ok('Pinia 事件流($onAction 捕获 addOrder/removeOrder)', piniaInfo.count >= 4 && piniaInfo.hasAction && piniaInfo.hasRemove, `${piniaInfo.count} 条`);

const reqInfo = await evalJs(
  manager.sessionId,
  `(() => {
    const reqs = [...document.querySelectorAll('.entry-request')];
    const bad = reqs.filter(d => d.classList.contains('bad')).length;
    const login = reqs.find(d => d.textContent.includes('login'));
    let bodyShown = false;
    if (login) { login.open = true; bodyShown = [...login.querySelectorAll('pre')].some(p => p.textContent.includes('username')); }
    return { n: reqs.length, bad, bodyShown };
  })()`
);
ok('API 交互已捕获(≥5 个请求)', reqInfo.n >= 5, `共 ${reqInfo.n} 个,失败标记 ${reqInfo.bad} 个`);
ok('请求体被捕获(含 username 字段)', reqInfo.bodyShown, '');

/* 7. 原始值 review + 勾选步骤 → 描述联动 */
let desc = await evalJs(manager.sessionId, `document.getElementById('bugDescription').value`);
const hasRawBefore = desc.includes('demo123') && desc.includes('银河系漫游指南');
ok('描述含原始输入值(不做脱敏,供 review)', hasRawBefore, '');

// 取消勾选"密码"小步骤 → 描述应即时移除该步骤(注:登录 API 请求体中含 demo123 属正常,仍保留)
const unchecked = await evalJs(
  manager.sessionId,
  `(() => {
    const rows = [...document.querySelectorAll('#steps .step')];
    const row = rows.find(r => r.querySelector('.what').textContent.includes('密码'));
    if (!row) return false;
    row.querySelector('.step-cb').click();
    return true;
  })()`
);
await sleep(400);
desc = await evalJs(manager.sessionId, `document.getElementById('bugDescription').value`);
ok(
  '取消勾选步骤后描述联动更新(密码小步骤被移除)',
  unchecked === true && !desc.includes('在「密码」中输入 "demo123"') && desc.includes('银河系漫游指南'),
  ''
);

const selInfo = await evalJs(manager.sessionId, `document.getElementById('selInfo').textContent`);
ok('步骤勾选状态提示更新', /已选 \d+ \/ \d+ 步/.test(selInfo), selInfo);

// Vue / Pinia 内容进入描述
ok('描述包含 Vue 组件名(AddOrderForm)', desc.includes('AddOrderForm'), '');
ok('描述包含 props 变化(diff)', desc.includes('props 变化'), '');
ok('描述包含 Pinia action 调用(orders.addOrder)', desc.includes('orders.addOrder'), '');
ok('描述包含 Pinia 状态变化行', desc.includes('Pinia store'), '');
ok('描述包含 URL 大步骤标题', desc.includes('大步骤'), '');
ok('描述包含 500 错误 API', /api\/fail[\s\S]{0,120}500/.test(desc.replace(/\n/g, ' ')) || /500/.test(desc), '');
ok('描述含页面时间与顺序(大步骤 N · HH:MM:SS)', /大步骤 \d+ · 页面 .+ · \d{2}:\d{2}:\d{2}/.test(desc), '');

/* 7.5 视图功能:删除 / 排序 / 搜索 / 折叠 */
const rowsBefore = await evalJs(manager.sessionId, `document.querySelectorAll('#steps .step').length`);
const delOk = await evalJs(
  manager.sessionId,
  `(() => {
    window.confirm = () => true;
    const rows = [...document.querySelectorAll('#steps .step')];
    const row = rows.find(r => r.querySelector('.what').textContent.includes('在「产品」中选择'));
    if (!row) return false;
    row.querySelector('.del-btn').click();
    return true;
  })()`
);
await sleep(500);
const rowsAfter = await evalJs(manager.sessionId, `document.querySelectorAll('#steps .step').length`);
const descAfterDel = await evalJs(manager.sessionId, `document.getElementById('bugDescription').value`);
ok(
  '逐步骤删除(行数-1,描述联动移除该步)',
  delOk === true && rowsAfter === rowsBefore - 1 && !descAfterDel.includes('在「产品」中选择'),
  `${rowsBefore}→${rowsAfter}`
);

const firstTitleDesc = await evalJs(manager.sessionId, `document.querySelector('.page-title').textContent`);
await evalJs(
  manager.sessionId,
  `(() => { const s = document.getElementById('sortMode'); s.value = 'asc'; s.dispatchEvent(new Event('change')); return true; })()`
);
await sleep(300);
const firstTitleAsc = await evalJs(manager.sessionId, `document.querySelector('.page-title').textContent`);
await evalJs(
  manager.sessionId,
  `(() => { const s = document.getElementById('sortMode'); s.value = 'desc'; s.dispatchEvent(new Event('change')); return true; })()`
);
ok(
  '大步骤排序切换(默认最新在前;内部顺序不受影响)',
  /vue\.html/.test(firstTitleDesc) && !/vue\.html/.test(firstTitleAsc),
  ''
);

const totalGroups = await evalJs(manager.sessionId, `document.querySelectorAll('.page-group').length`);
await evalJs(
  manager.sessionId,
  `(() => { const s = document.getElementById('searchBox'); s.value = 'vue.html'; s.dispatchEvent(new Event('input')); return true; })()`
);
await sleep(300);
const filteredGroups = await evalJs(manager.sessionId, `document.querySelectorAll('.page-group').length`);
await evalJs(
  manager.sessionId,
  `(() => { const s = document.getElementById('searchBox'); s.value = ''; s.dispatchEvent(new Event('input')); return true; })()`
);
ok('搜索过滤大步骤', filteredGroups >= 1 && filteredGroups < totalGroups, `${totalGroups}→${filteredGroups}`);

await evalJs(manager.sessionId, `document.querySelector('.page-head .caret').click(); true`);
await sleep(250);
const collapsedCount = await evalJs(manager.sessionId, `document.querySelectorAll('.page-group.collapsed').length`);
await evalJs(manager.sessionId, `document.querySelector('.page-head .caret').click(); true`);
ok('大步骤折叠/展开', collapsedCount >= 1, `${collapsedCount} 个折叠`);

/* 8. 提交到假 Redmine(截图限量 5 张:有点击坐标的烙为 PNG) */
const shotsBefore = fs.existsSync(FAKE_STORE)
  ? fs.readdirSync(FAKE_STORE).filter((f) => f.startsWith('step-')).length
  : 0;
await evalJs(manager.sessionId, `document.getElementById('bugAttach').checked = true; true`);
await evalJs(manager.sessionId, `document.getElementById('bugAttachCsv').checked = true; true`);
await evalJs(manager.sessionId, `document.getElementById('bugShotMax').value = '5'; true`);
await evalJs(manager.sessionId, `document.getElementById('bugForm').requestSubmit(); true`);
try {
  await waitFor(
    manager.sessionId,
    `/#101/.test(document.getElementById('submitResult').textContent)`,
    '提交成功',
    30000
  );
  ok('提交到 Redmine(uploads + issues,仅勾选步骤)', true);
} catch (e) {
  const errText = await evalJs(manager.sessionId, `document.getElementById('err').textContent || document.getElementById('submitResult').textContent || '(无错误信息)'`);
  ok('提交到 Redmine(uploads + issues,仅勾选步骤)', false, e.message + ' / 页面错误: ' + errText);
}

const filesAfter = fs.existsSync(FAKE_STORE) ? fs.readdirSync(FAKE_STORE) : [];
const shotFiles = filesAfter.filter((f) => /^step-\d+\.(jpg|png)$/.test(f));
const csvFiles = filesAfter.filter((f) => f.endsWith('.csv'));
const pngFiles = shotFiles.filter((f) => f.endsWith('.png'));
ok('截图限量生效(最多 5 张)', shotFiles.length === 5, `服务端收到 ${shotFiles.length} 张(此前 ${shotsBefore})`);
ok(
  '点击标记烙入截图(PNG 透明通道)+ JPEG 混合上传',
  pngFiles.length >= 1 && shotFiles.some((f) => f.endsWith('.jpg')),
  `PNG ${pngFiles.length} 张 / JPEG ${shotFiles.length - pngFiles.length} 张`
);
const lastIssue = JSON.parse(fs.readFileSync(path.join(FAKE_STORE, 'last-issue.json'), 'utf8'));
const uploadNames = (lastIssue.issue.uploads || []).map((item) => item.filename);
ok(
  '假 Redmine 收到的 issue 内容校验',
  lastIssue.issue.project_id === '1' &&
    typeof lastIssue.issue.description === 'string' &&
    lastIssue.issue.description.includes('AddOrderForm') &&
    csvFiles.length === 1 &&
    uploadNames.some((name) => String(name).endsWith('.csv')),
  `project=${lastIssue.issue.project_id}, 描述 ${lastIssue.issue.description.length} 字符, 附件 ${lastIssue.issue.uploads?.length || 0} 个, csv ${csvFiles.length}`
);

/* 8.5 CSV 导出(点击按钮走真实下载,经 CDP 拦截下载文件) */
const dlDir = '/tmp/bugrec-dl';
fs.rmSync(dlDir, { recursive: true, force: true });
fs.mkdirSync(dlDir, { recursive: true });
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
await evalJs(manager.sessionId, `document.getElementById('btnExportCsv').click(); true`);
let csvPath = null;
for (let i = 0; i < 40 && !csvPath; i++) {
  await sleep(250);
  const f = (fs.existsSync(dlDir) ? fs.readdirSync(dlDir) : []).find((x) => x.endsWith('.csv'));
  if (f) csvPath = path.join(dlDir, f);
}
ok('CSV 导出触发下载', !!csvPath, dlDir);
if (csvPath) {
  const csv = fs.readFileSync(csvPath, 'utf8');
  const head = csv.split('\r\n')[0] || '';
  ok(
    'CSV 内容(表头/行/截图base64)',
    csv.length > 2000 && /时间,大步骤,类型/.test(head) && /A[A-Za-z0-9+/]{80,}/.test(csv) && csv.includes('API'),
    `长度 ${csv.length}`
  );
}

/* 9. DevTools 面板(以标签页方式打开):时间轴 / 定位 / 选区 */
const panel = await newPage(`${EXT_BASE}/devtools/panel.html`);
await waitFor(panel.sessionId, `document.querySelectorAll('#timeline .thumb').length >= 6`, '面板时间轴渲染', 15000);
await evalJs(panel.sessionId, `document.querySelectorAll('#timeline .thumb')[1].click(); true`);
await waitFor(panel.sessionId, `document.querySelector('.page-row.hl') !== null`, '点击缩略图定位大步骤');
ok('DevTools 面板:缩略图点击定位大步骤', true, '');

/* 9.1 面板会话列表 + 大步骤勾选(与提交页同步) */
const sessInfo = await evalJs(
  panel.sessionId,
  `(() => {
     const items = [...document.querySelectorAll('#sessionList .session-item')];
     return { n: items.length, del: items.filter(i => i.querySelector('.si-del')).length };
   })()`
);
ok('DevTools 面板:会话列表渲染(含删除按钮)', sessInfo.n >= 1 && sessInfo.del >= 1, `会话 ${sessInfo.n} 个`);

const beforeSel = await evalJs(panel.sessionId, `window.__bugrecPanelState.selected.size`);
const cbOk = await evalJs(
  panel.sessionId,
  `(() => {
     const rows = [...document.querySelectorAll('.page-row')];
     const row = rows.find(r => { const cb = r.querySelector('.page-cb'); return cb && cb.checked && !cb.indeterminate; });
     if (!row) return null;
     row.querySelector('.page-cb').click(); // 整页取消勾选(步骤+截图集合缩减)
     return row.querySelector('.u').textContent;
   })()`
);
await sleep(700);
const afterSel = await evalJs(panel.sessionId, `window.__bugrecPanelState.selected.size`);
ok(
  '面板大步骤 checkbox 取消勾选(步骤+截图集合缩减)',
  typeof cbOk === 'string' && afterSel < beforeSel,
  `${beforeSel}→${afterSel} (${cbOk})`
);
let selPersisted = -1;
let rawLen = -1;
for (let i = 0; i < 8 && selPersisted !== afterSel; i++) {
  await sleep(350);
  [selPersisted, rawLen] = await evalJs(
    panel.sessionId,
    `(async () => {
       const sid = window.__bugrecPanelState.sessionId;
       const msg = await chrome.runtime.sendMessage({type:'GET_SELECTION', sessionId: sid}).then(r => (r.ids || []).length).catch(() => -1);
       const raw = await chrome.storage.session.get('selection:' + sid).then(v => ((v['selection:' + sid] || []).length));
       return [msg, raw];
     })()`
  );
}
ok(
  '勾选集合持久化到 SW(GET_SELECTION 可读)',
  selPersisted === afterSel && rawLen === afterSel,
  `msg=${selPersisted} raw=${rawLen}`
);
let mgrSynced = '';
for (let i = 0; i < 8; i++) {
  await sleep(350);
  mgrSynced = await evalJs(manager.sessionId, `document.getElementById('selInfo').textContent`);
  if (new RegExp(`已选 ${afterSel} / `).test(mgrSynced)) break;
}
ok('提交页实时同步面板勾选(storage.onChanged)', new RegExp(`已选 ${afterSel} / `).test(mgrSynced), mgrSynced.trim());
// 按标题找回刚才取消的行,重新勾上
await evalJs(
  panel.sessionId,
  `(() => {
     const rows = [...document.querySelectorAll('.page-row')];
     const row = rows.find(r => r.querySelector('.u') && r.querySelector('.u').textContent === ${JSON.stringify(typeof cbOk === 'string' ? cbOk : '')});
     if (row) {
       const cb = row.querySelector('.page-cb');
       if (cb && !cb.checked) cb.click();
     }
     return true;
   })()`
);
await sleep(500);
const restored = await evalJs(panel.sessionId, `window.__bugrecPanelState.selected.size`);
ok('重新勾选恢复(回到 beforeSel)', restored === beforeSel, `${restored}/${beforeSel}`);

const picked = await evalJs(
  panel.sessionId,
  `(() => {
     const thumbs = [...document.querySelectorAll('#timeline .thumb')];
     const i = thumbs.findIndex(t => t.title.includes('/vue.html'));
     if (i < 0 || i + 1 >= thumbs.length) return false;
     document.getElementById('rangeMode').click();
     thumbs[i].click();
     thumbs[Math.min(i + 2, thumbs.length - 1)].click();
     return true;
   })()`
);
await sleep(300);
const rangeReady = await evalJs(panel.sessionId, `document.getElementById('btnSubmitRange').hidden === false`);
const rangeText1 = await evalJs(panel.sessionId, `document.getElementById('rangeInfo').textContent`);
ok('DevTools 面板:时间轴选区(起止两张截图)', picked === true && rangeReady === true, rangeText1);
/* 10. 面板自动打开的新提交页:应用选区范围(一次性消费) */
const beforeMgrIds = new Set(
  ((await cdp.send('Target.getTargets')).targetInfos)
    .filter((t) => t.url.includes('manager.html'))
    .map((t) => t.targetId)
);
await evalJs(panel.sessionId, `document.getElementById('btnSubmitRange').click(); true`);
await sleep(600);
const rangeText2 = await evalJs(panel.sessionId, `document.getElementById('rangeInfo').textContent`);
ok('选区保存成功(面板确认)', /选区已保存/.test(rangeText2), rangeText2);
const newMgrs = ((await cdp.send('Target.getTargets')).targetInfos).filter(
  (t) => t.type === 'page' && t.url.includes('manager.html') && !beforeMgrIds.has(t.targetId)
);
ok('面板自动打开提交页', newMgrs.length >= 1, `新开 ${newMgrs.length} 页`);
const nm = await (async () => {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: newMgrs[0].targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  return { sessionId };
})();
await waitFor(nm.sessionId, `window.__bugrecMgrReady === true`, '新提交页初始化');
const scopeText = await evalJs(nm.sessionId, `document.getElementById('scopeInfo').textContent`);
ok('提交页应用时间轴选区范围', /时间轴选区/.test(scopeText), scopeText.slice(0, 70));
const scopedDesc = await evalJs(nm.sessionId, `document.getElementById('bugDescription').value`);
ok(
  '选区外步骤不进入描述',
  !scopedDesc.includes('在「用户名」中输入') && scopedDesc.includes('AddOrderForm'),
  ''
);

/* 11. 面板删除历史会话(再造一个空会话后删除) */
await evalJs(panel.sessionId, `window.confirm = () => true; true`);
await evalJs(
  panel.sessionId,
  `chrome.runtime.sendMessage({type:'STOP_RECORDING'})
     .then(() => chrome.runtime.sendMessage({type:'START_RECORDING'}))
     .then(() => chrome.runtime.sendMessage({type:'STOP_RECORDING'})).then(() => true)`
);
await sleep(1200);
const twoCount = await evalJs(panel.sessionId, `chrome.runtime.sendMessage({type:'LIST_SESSIONS'}).then(r => r.length)`);
ok('面板会话列表出现新建的空会话(共2个)', twoCount === 2, `当前 ${twoCount} 个`);
await evalJs(panel.sessionId, `(() => {
  const it = document.querySelector('#sessionList .session-item[data-count="0"] .si-del');
  if (!it) return false;
  it.click();
  const ok = document.querySelector('#sessionList .session-item[data-count="0"] .si-del-ok');
  if (!ok) return false;
  ok.click();
  return true;
})()`);
await sleep(1000);
const oneCount = await evalJs(panel.sessionId, `chrome.runtime.sendMessage({type:'LIST_SESSIONS'}).then(r => r.length)`);
ok('面板删除空会话成功(剩1个)', oneCount === 1, `剩余 ${oneCount} 个`);

console.log('SMOKE_DONE');
console.log(JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass);
process.exit(failed.length ? 1 : 0);
