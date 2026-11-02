// 管理页逻辑:设置、会话列表、页面分组的步骤勾选(截图/Vue/Pinia 预览)、
// API 与 Pinia 记录、生成描述(仅含勾选步骤)并提交 Redmine。
import {
  describeAction,
  buildDescription,
  buildSubject,
  groupByPage,
  computePropsDiffs,
  fmtTime,
} from '../shared/report.js';

const $ = (id) => document.getElementById(id);

let settings = {};
let sessions = [];
let currentId = null; // 当前查看的会话 id
let cache = null; // { session, actions, requests, logs, pinia }
let selected = new Set(); // 勾选的 action id
let subjectDirty = false;
let descDirty = false;

function send(msg) {
  return chrome.runtime.sendMessage(msg).then((res) => {
    if (res && res.error) throw new Error(res.error);
    return res;
  });
}

function showError(e) {
  const el = $('err');
  el.hidden = false;
  el.textContent = String((e && e.message) || e);
  clearTimeout(el.__t);
  el.__t = setTimeout(() => (el.hidden = true), 6000);
}

/* ---------------- 录制状态 ---------------- */

async function refreshRecState() {
  const st = await send({ type: 'GET_STATE' });
  $('dot').classList.toggle('on', st.recording);
  $('recText').textContent = st.recording ? '录制中' : '未录制';
  $('btnToggleRec').textContent = st.recording ? '■ 停止录制' : '● 开始录制';
  return st;
}

$('btnToggleRec').addEventListener('click', async () => {
  try {
    const st = await send({ type: 'GET_STATE' });
    const res = await send({ type: st.recording ? 'STOP_RECORDING' : 'START_RECORDING' });
    await refreshRecState();
    await refreshSessions();
    selectSession(st.recording ? st.sessionId : res.sessionId);
  } catch (e) {
    showError(e);
  }
});

/* ---------------- 设置 ---------------- */

async function loadSettings() {
  settings = await send({ type: 'SETTINGS_GET' });
  $('setUrl').value = settings.redmineUrl || '';
  $('setKey').value = settings.apiKey || '';
  $('setBodies').checked = settings.captureBodies !== false;
}

$('btnSaveSettings').addEventListener('click', async () => {
  settings = {
    ...settings,
    redmineUrl: $('setUrl').value.trim(),
    apiKey: $('setKey').value.trim(),
    captureBodies: $('setBodies').checked,
  };
  try {
    await send({ type: 'SETTINGS_SET', settings });
    $('testResult').textContent = '✅ 已保存';
    setTimeout(() => ($('testResult').textContent = ''), 3000);
  } catch (e) {
    showError(e);
  }
});

$('btnTest').addEventListener('click', async () => {
  $('testResult').textContent = '连接中…';
  try {
    const tmp = { redmineUrl: $('setUrl').value.trim(), apiKey: $('setKey').value.trim() };
    const info = await send({ type: 'TEST_REDMINE', settings: tmp });
    $('testResult').textContent = `✅ 连接成功:${info.login} (${info.name})`;
  } catch (e) {
    $('testResult').textContent = '';
    showError(e);
  }
});

/* ---------------- 会话列表 ---------------- */

async function refreshSessions() {
  sessions = await send({ type: 'LIST_SESSIONS' });
  const box = $('sessions');
  box.textContent = '';
  for (const s of sessions) {
    const div = document.createElement('div');
    div.className = 'session' + (s.id === currentId ? ' sel' : '');
    div.dataset.id = s.id;

    const t = document.createElement('div');
    t.className = 't';
    t.textContent = fmtTime(s.startedAt);
    const sub = document.createElement('div');
    sub.className = 's';
    const chip = document.createElement('span');
    const statusText = { recording: '录制中', stopped: '已停止', submitted: `已提交 #${s.issueId || ''}` }[s.status] || s.status;
    chip.className = `status-chip status-${s.status}`;
    chip.textContent = statusText;
    sub.append(
      chip,
      document.createTextNode(
        ` 步骤 ${s.actionCount} · API ${s.requestCount}${s.piniaCount ? ` · Pinia ${s.piniaCount}` : ''}`
      )
    );

    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '✕';
    del.title = '删除会话';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('确认删除该会话及其所有截图/记录?')) return;
      await send({ type: 'DELETE_SESSION', id: s.id });
      if (currentId === s.id) {
        currentId = null;
        cache = null;
        renderDetail();
      }
      refreshSessions();
    });

    div.append(t, sub, del);
    div.addEventListener('click', () => selectSession(s.id));
    box.appendChild(div);
  }
  if (!sessions.length) {
    box.innerHTML = '<div style="padding:16px;color:#80868b;font-size:12px;">暂无会话</div>';
  }
}

$('btnRefresh').addEventListener('click', refreshSessions);

/* ---------------- 会话详情 ---------------- */

async function selectSession(id) {
  currentId = id;
  subjectDirty = false;
  descDirty = false;
  $('submitResult').textContent = '';
  document.querySelectorAll('.session').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
  if (!id) return renderDetail();
  try {
    cache = await send({ type: 'GET_SESSION', id });
  } catch (e) {
    cache = null;
    showError(e);
  }
  if (cache) {
    selected = new Set(cache.actions.map((a) => a.id)); // 默认全选,review 时可去掉
  }
  renderDetail(true);
}

function selectedActions() {
  if (!cache) return [];
  return cache.actions.filter((a) => selected.has(a.id));
}

function renderDetail(prefillForm = false) {
  const box = $('sessionDetail');
  if (!cache) {
    box.hidden = true;
    $('noSession').hidden = false;
    return;
  }
  box.hidden = false;
  $('noSession').hidden = true;

  const { session, actions, requests, logs, pinia } = cache;
  $('detailTitle').textContent = `会话 ${fmtTime(session.startedAt)}`;
  const lastUrl = actions.length ? actions[actions.length - 1].url : '';
  $('detailMeta').textContent =
    `${actions.length} 个步骤 · ${requests.length} 个 API 请求 · ${logs.length} 条日志 · ${pinia.length} 条 Pinia 事件` +
    (lastUrl ? ` · ${lastUrl}` : '');

  renderSteps(actions);
  renderRequests(requests);
  renderPinia(pinia);
  updateSelInfo();

  if (prefillForm && !subjectDirty) {
    $('bugSubject').value = session.subject || buildSubject(session, actions);
  }
  if (prefillForm && !descDirty) {
    regenerateDescription();
  }
  // 提交 handler 的成功文案若已写入,不覆盖
  if (session.issueUrl && !$('submitResult').textContent.trim()) {
    $('submitResult').innerHTML = `已提交:<a href="${session.issueUrl}" target="_blank">${session.issueUrl}</a>`;
  }
}

/* ---------------- 步骤区:URL 大步骤 + 小步骤勾选 ---------------- */

function renderSteps(actions) {
  const box = $('steps');
  box.textContent = '';
  const pages = groupByPage(actions);
  const propsDiffs = computePropsDiffs(actions);
  const shotSeq = new Map();
  let n = 0;
  for (const a of actions) if (a.screenshot) shotSeq.set(a.id, ++n);

  pages.forEach((page, pi) => {
    const nav = page.navigate;
    const group = document.createElement('div');
    group.className = 'page-group';

    const head = document.createElement('label');
    head.className = 'page-head';
    const allInPage = page.steps.every((a) => selected.has(a.id));
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = allInPage;
    cb.addEventListener('change', () => {
      for (const a of page.steps) {
        cb.checked ? selected.add(a.id) : selected.delete(a.id);
      }
      renderSteps(cache.actions);
      onSelectionChanged();
    });
    const headText = document.createElement('span');
    const shot = nav && shotSeq.get(nav.id);
    headText.innerHTML =
      `📄 <b>大步骤 ${pi + 1}</b> · ${escapeHtml(page.url)}` +
      (page.title ? ` <span class="count">(${escapeHtml(page.title)})</span>` : '') +
      (shot ? ` <span class="count">整页截图 ✓</span>` : '');
    head.append(cb, headText);
    group.appendChild(head);

    let stepNo = 0;
    page.steps.forEach((a) => {
      if (a.kind === 'navigate' && a === nav) return;
      stepNo += 1;
      const row = document.createElement('div');
      row.className = 'step';
      if (!selected.has(a.id)) row.classList.add('off');

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'step-cb';
      cb.checked = selected.has(a.id);
      cb.addEventListener('change', () => {
        cb.checked ? selected.add(a.id) : selected.delete(a.id);
        row.classList.toggle('off', !cb.checked);
        onSelectionChanged();
      });

      const body = document.createElement('div');
      body.className = 'body';
      const what = document.createElement('div');
      what.className = 'what';
      what.textContent = `${stepNo}. ${describeAction(a)}`;
      const sub = document.createElement('div');
      sub.className = 'sub';
      const bits = [];
      if (a.selector) bits.push(`<code>${escapeHtml(a.selector)}</code>`);
      if (a.kind === 'click' && a.href) bits.push(`→ ${escapeHtml(a.href)}`);
      if (a.value) bits.push(`值: ${escapeHtml(String(a.value).slice(0, 120))}`);
      sub.innerHTML = bits.join(' · ') || '&nbsp;';

      const badges = document.createElement('div');
      badges.className = 'badges';
      if (a.vue && a.vue.component) {
        const comp = document.createElement('span');
        comp.className = 'badge vue';
        comp.textContent = `Vue: ${a.vue.component}`;
        const chain = a.vue.chain && a.vue.chain.length > 1 ? ` (${a.vue.chain.join(' > ')})` : '';
        comp.title = `组件链${chain}`;
        badges.appendChild(comp);
      }
      if (a.vue && a.vue.props) {
        const pd = propsDiffs.get(a.id);
        const props = document.createElement('details');
        props.className = 'badge props';
        const s = document.createElement('summary');
        s.textContent = pd && pd.changes.length ? `props (${pd.changes.length} 处变化)` : 'props';
        props.appendChild(s);
        const pre = document.createElement('div');
        pre.className = 'props-body';
        pre.textContent = (a.vue.props || '') + (pd && pd.changes.length ? `\n\n与上次相比:\n${pd.changes.join('\n')}` : '');
        props.appendChild(pre);
        badges.appendChild(props);
      }
      if (a.vue && a.vue.piniaChanges && a.vue.piniaChanges.length) {
        const pin = document.createElement('span');
        pin.className = 'badge pinia';
        pin.textContent = `Pinia ${a.vue.piniaChanges.filter((c) => !c.firstSeen).length || '首次'} 变化`;
        pin.title = a.vue.piniaChanges.map((c) => `${c.storeId}: ${c.state.slice(0, 200)}`).join('\n');
        badges.appendChild(pin);
      }

      body.append(what, sub, badges);

      const img = document.createElement('img');
      if (a.screenshot) {
        img.src = a.screenshot;
        img.title = `小步骤 ${stepNo} 截图`;
        img.addEventListener('click', () => openLightbox(a.screenshot));
      } else {
        img.className = 'none';
        img.alt = '';
      }

      row.append(cb, body, img);
      group.appendChild(row);
    });

    box.appendChild(group);
  });
}

function onSelectionChanged() {
  updateSelInfo();
  if (!descDirty) regenerateDescription();
  $('selAll').checked = cache && selected.size === cache.actions.length;
}

function updateSelInfo() {
  $('selInfo').textContent = cache
    ? `已选 ${selected.size} / ${cache.actions.length} 步(未选步骤不会进入描述与截图附件)`
    : '';
}

$('selAll').addEventListener('change', () => {
  if (!cache) return;
  selected = new Set($('selAll').checked ? cache.actions.map((a) => a.id) : []);
  renderSteps(cache.actions);
  onSelectionChanged();
});

/* ---------------- API / Pinia 记录区 ---------------- */

function renderRequests(requests) {
  $('reqCount').textContent = requests.length ? `(${requests.length})` : '(无)';
  const box = $('requests');
  box.textContent = '';
  for (const r of requests) {
    const d = document.createElement('details');
    d.className = 'req' + (r.error || (r.status && r.status >= 400) ? ' bad' : '');
    const sum = document.createElement('summary');

    const m = document.createElement('span');
    m.className = 'method';
    m.textContent = r.method;
    const u = document.createElement('span');
    u.className = 'u';
    u.textContent = shortenUrl(r.url);
    u.title = r.url;
    const pill = document.createElement('span');
    if (r.error) {
      pill.className = 'status-pill err';
      pill.textContent = r.error.slice(0, 24);
    } else {
      pill.className = 'status-pill' + (r.status >= 400 ? ' bad' : '');
      pill.textContent = r.status || '?';
    }
    const dur = document.createElement('span');
    dur.className = 'u';
    dur.style.color = '#80868b';
    dur.textContent = r.durationMs != null ? `${r.durationMs}ms` : '';
    sum.append(m, u, pill, dur);

    const pre1 = document.createElement('pre');
    pre1.textContent = `请求体:\n${r.requestBody || '(空 / 未捕获)'}`;
    const pre2 = document.createElement('pre');
    if (r.responseBody !== undefined) {
      pre2.textContent = `响应体:\n${r.responseBody === null ? '(非文本内容,不展示)' : r.responseBody || '(空)'}`;
    } else {
      pre2.textContent = '响应体:未捕获(需要开启"捕获 API 请求/响应体",仅 Chrome)';
    }
    d.append(sum, pre1, pre2);
    box.appendChild(d);
  }
}

function renderPinia(events) {
  $('piniaCount').textContent = events.length ? `(${events.length})` : '(未检测到 Pinia 或无变更)';
  const box = $('piniaEvents');
  box.textContent = '';
  if (!events.length) return;
  for (const ev of events.slice(-40)) {
    const div = document.createElement('div');
    div.className = 'pinia-line';
    const t = document.createElement('span');
    t.className = 'count';
    t.textContent = new Date(ev.ts).toLocaleTimeString('zh-CN', { hour12: false }) + ' ';
    div.appendChild(t);
    div.appendChild(document.createTextNode(describePiniaEvent(ev)));
    box.appendChild(div);
  }
}

function describePiniaEvent(ev) {
  if (ev.action) {
    return `调用 ${ev.storeId}.${ev.action}()${ev.args && ev.args !== '[]' ? ` 参数 ${ev.args}` : ''}`;
  }
  return `${ev.storeId} ${ev.changeType || '变更'}${ev.keys && ev.keys.length ? ` 字段 [${ev.keys.join(', ')}]` : ''}`;
}

function shortenUrl(url, max = 110) {
  try {
    const u = new URL(url);
    const s = u.pathname + (u.search || '');
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch {
    return url;
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/* ---------------- 描述生成与提交 ---------------- */

function regenerateDescription() {
  if (!cache) return;
  const acts = selectedActions();
  const { session, requests, logs, pinia } = cache;
  const lastUrl = acts.length ? acts[acts.length - 1].url : cache.actions.length ? cache.actions[cache.actions.length - 1].url : '';
  $('bugDescription').value = buildDescription(
    session,
    acts,
    requests,
    logs,
    { userAgent: navigator.userAgent, lastUrl },
    { piniaEvents: pinia }
  );
}

$('bugSubject').addEventListener('input', () => (subjectDirty = true));
$('bugDescription').addEventListener('input', () => (descDirty = true));

$('btnRegen').addEventListener('click', () => {
  regenerateDescription();
  descDirty = false;
});

$('btnCopyDesc').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('bugDescription').value);
    $('btnCopyDesc').textContent = '已复制 ✓';
    setTimeout(() => ($('btnCopyDesc').textContent = '复制描述'), 2000);
  } catch {
    showError(new Error('复制失败,请手动全选复制'));
  }
});

$('btnLoadProjects').addEventListener('click', async () => {
  try {
    const projects = await send({ type: 'LIST_PROJECTS' });
    fillSelect($('bugProject'), projects, settings.projectId);
    if (!projects.length) showError(new Error('项目列表为空:请确认 API Key 所属账号有项目权限'));
  } catch (e) {
    showError(e);
  }
});

async function loadTrackersAndPriorities() {
  try {
    const trackers = await send({ type: 'LIST_TRACKERS' });
    fillSelect($('bugTracker'), trackers, settings.trackerId);
    const prios = await send({ type: 'LIST_PRIORITIES' });
    fillSelect($('bugPriority'), prios, settings.priorityId);
  } catch {
    /* 非致命:保留"(默认)"选项 */
  }
}

function fillSelect(sel, items, presetId) {
  const current = sel.value;
  sel.textContent = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = sel.id === 'bugProject' ? '(请选择项目)' : '(默认)';
  sel.appendChild(opt0);
  for (const it of items) {
    const o = document.createElement('option');
    o.value = String(it.id);
    o.textContent = it.name;
    sel.appendChild(o);
  }
  const want = current || (presetId != null ? String(presetId) : '');
  if (want) sel.value = want;
}

$('bugForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!cache) return;
  const btn = $('btnSubmit');
  btn.disabled = true;
  btn.textContent = '提交中…';
  $('submitResult').textContent = '';
  try {
    const res = await send({
      type: 'SUBMIT_REDMINE',
      sessionId: cache.session.id,
      subject: $('bugSubject').value.trim(),
      description: $('bugDescription').value,
      projectId: $('bugProject').value,
      trackerId: $('bugTracker').value,
      priorityId: $('bugPriority').value,
      attachScreenshots: $('bugAttach').checked,
      selectedActionIds: [...selected],
    });
    $('submitResult').innerHTML =
      `✅ 已创建 issue <b>#${res.issueId}</b>(含 ${res.uploadCount} 张截图):` +
      `<a href="${res.issueUrl}" target="_blank">${res.issueUrl}</a>`;
    refreshSessions();
  } catch (err) {
    showError(err);
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 提交到 Redmine';
  }
});

/* ---------------- 导出 / 大图预览 / 实时刷新 ---------------- */

$('btnExport').addEventListener('click', () => {
  if (!cache) return;
  const { session, actions, requests, logs, pinia } = cache;
  const stripped = actions.map((a) => ({ ...a, screenshot: a.screenshot ? '<dataURL 截图,略>' : null }));
  const blob = new Blob([JSON.stringify({ session, actions: stripped, requests, logs, pinia }, null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bug-recorder-session-${session.id.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

function openLightbox(src) {
  $('lightboxImg').src = src;
  $('lightbox').hidden = false;
}
$('lightbox').addEventListener('click', () => ($('lightbox').hidden = true));

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'SESSION_UPDATED') {
    refreshSessions();
    // 正在查看的会话有新内容:静默刷新,不打扰正在填写的表单(新步骤默认勾选)
    if (msg.sessionId === currentId) {
      send({ type: 'GET_SESSION', id: currentId })
        .then((data) => {
          cache = data;
          for (const a of data.actions) selected.add(a.id);
          renderDetail();
          if (!descDirty) regenerateDescription();
        })
        .catch(() => {});
    }
  }
});

/* ---------------- 启动 ---------------- */

(async function init() {
  await loadSettings();
  await refreshRecState();
  await refreshSessions();
  loadTrackersAndPriorities();
  const st = await send({ type: 'GET_STATE' });
  if (st.recording && st.sessionId) {
    selectSession(st.sessionId);
  } else if (sessions.length) {
    selectSession(sessions[0].id);
  }
  window.__bugrecMgrReady = true; // 供自动化测试等待初始化完成
})();
