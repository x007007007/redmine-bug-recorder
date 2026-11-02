// DevTools「Bug Recorder」面板:时间轴缩略图(点击定位大步骤/选范围)、大步骤分页列表、
// 选区一键交给提交页。复用 manager/api.js 与 shared 模块,UI 保持紧凑。

import { send } from '../manager/api.js';
import { $ } from '../manager/dom.js';
import { buildPages } from '../shared/timeline.js';
import { describeAction } from '../shared/describe.js';
import { renderPages, PAGE_SIZE, clockOf } from './panel-pages.js';

const state = {
  recording: false,
  sessionId: null,
  cache: null,
  pages: [],
  pageIdx: 0,
  highlightKey: null,
  rangeMode: false,
  rangeFromTs: null,
  range: null, // { fromTs, toTs }
};

function init() {
  $('btnToggle').addEventListener('click', async () => {
    const st = await send({ type: 'GET_STATE' });
    await send({ type: st.recording ? 'STOP_RECORDING' : 'START_RECORDING' });
    refreshState();
  });
  $('btnOpenMgr').addEventListener('click', () => {
    const url = chrome.runtime.getURL('manager/manager.html');
    try {
      chrome.tabs.create({ url });
    } catch {
      window.open(url, '_blank');
    }
  });
  $('rangeMode').addEventListener('change', () => {
    state.rangeMode = $('rangeMode').checked;
    if (!state.rangeMode) clearRange();
    else $('rangeInfo').textContent = '依次点击两张截图:第一张为起点,第二张为终点';
  });
  $('btnClearRange').addEventListener('click', clearRange);
  $('btnSubmitRange').addEventListener('click', submitRange);
  $('pgPrev').addEventListener('click', () => setPage(state.pageIdx - 1));
  $('pgNext').addEventListener('click', () => setPage(state.pageIdx + 1));
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'SESSION_UPDATED') refreshState();
  });
  refreshState();
}

async function refreshState() {
  const st = await send({ type: 'GET_STATE' });
  state.recording = st.recording;
  state.sessionId = st.sessionId;
  $('dot').classList.toggle('on', st.recording);
  $('recText').textContent = st.recording ? '录制中' : '未录制';
  $('btnToggle').textContent = st.recording ? '■ 停止录制' : '● 开始录制';
  if (st.sessionId) {
    state.cache = await send({ type: 'GET_SESSION', id: st.sessionId });
  } else {
    state.cache = null;
  }
  state.pages = state.cache
    ? buildPages(state.cache.actions, state.cache.requests, state.cache.pinia).map((p) => ({
        ...p,
        tabLabel: null,
      }))
    : [];
  renderTimeline();
  setPage(0);
}

/* ---------- 时间轴缩略图 ---------- */

function renderTimeline() {
  const box = $('timeline');
  box.textContent = '';
  if (!state.cache || !state.cache.actions.length) {
    box.innerHTML = '<div class="empty">开始录制后,每步截图将按时间显示在这里;点击可定位大步骤,选范围后可只提交该范围。</div>';
    return;
  }
  const inRangeTs = (ts) => state.range && ts >= state.range.fromTs && ts <= state.range.toTs;
  for (const a of state.cache.actions) {
    if (!a.screenshot) continue;
    const t = document.createElement('div');
    t.className = 'thumb' + (inRangeTs(a.ts) ? ' in-range' : '');
    t.title = `${clockOf(a.ts)} ${describeAction(a)}`;
    const img = document.createElement('img');
    img.src = a.screenshot;
    const cap = document.createElement('span');
    cap.className = 'cap';
    cap.textContent = clockOf(a.ts);
    t.append(img, cap);
    t.addEventListener('click', () => onThumbClick(a));
    box.appendChild(t);
  }
}

function onThumbClick(a) {
  if (state.rangeMode) {
    if (state.rangeFromTs == null) {
      // 第一下:选起点
      state.rangeFromTs = a.ts;
      state.range = null;
      $('rangeInfo').textContent = `起点 ${clockOf(a.ts)} 已选,再点击终点截图`;
      $('btnClearRange').hidden = false;
      renderTimeline();
      return;
    }
    // 第二下:起止两点成区间
    const from = Math.min(state.rangeFromTs, a.ts);
    const to = Math.max(state.rangeFromTs, a.ts);
    state.range = { fromTs: from, toTs: to };
    const n = state.cache.actions.filter((x) => x.ts >= from && x.ts <= to).length;
    $('rangeInfo').textContent = `选区 ${clockOf(from)} ~ ${clockOf(to)}(约 ${n} 步),可按此范围去提交`;
    $('btnSubmitRange').hidden = false;
    renderTimeline();
    return;
  }
  locate(a.ts);
}

/* ---------- 大步骤分页列表 ---------- */

function setPage(idx) {
  const total = Math.max(1, Math.ceil(state.pages.length / PAGE_SIZE));
  state.pageIdx = Math.min(Math.max(0, idx), total - 1);
  const slice = state.pages.slice(state.pageIdx * PAGE_SIZE, (state.pageIdx + 1) * PAGE_SIZE);
  renderPages($('pages'), slice, { highlightKey: state.highlightKey });
  $('pgInfo').textContent = `${state.pageIdx + 1} / ${total}`;
  $('pgPrev').disabled = state.pageIdx === 0;
  $('pgNext').disabled = state.pageIdx >= total - 1;
}

function locate(ts) {
  const p = state.pages.find((x) => ts >= x.startTime && ts <= x.endTime);
  if (!p) return;
  state.highlightKey = p.key;
  setPage(Math.floor(state.pages.indexOf(p) / PAGE_SIZE));
  const row = [...$('pages').children].find((el) => el.__pageKey === p.key);
  if (row && row.__locate) row.__locate();
}

/* ---------- 选区提交 ---------- */

function clearRange() {
  state.range = null;
  state.rangeFromTs = null;
  $('rangeInfo').textContent = state.rangeMode ? '依次点击两张截图:第一张为起点,第二张为终点' : '点击下方截图可定位大步骤';
  $('btnClearRange').hidden = true;
  $('btnSubmitRange').hidden = true;
  renderTimeline();
}

async function submitRange() {
  if (!state.range) {
    $('rangeInfo').textContent = '请先点击起点与终点两张截图';
    return;
  }
  if (!state.sessionId) {
    $('rangeInfo').textContent = '会话未就绪(尚未开始录制?),无法设置范围';
    return;
  }
  const payload = { sessionId: state.sessionId, fromTs: state.range.fromTs, toTs: state.range.toTs };
  // session 区不可用时兜底到 local(两者提交页都能读到)
  try {
    try {
      await chrome.storage.session.set({ submitRange: payload });
    } catch {
      await chrome.storage.local.set({ submitRange: payload });
    }
    const back = await (chrome.storage.session || chrome.storage.local).get('submitRange');
    if (!back || !back.submitRange) throw new Error('写入后读回为空');
    $('rangeInfo').textContent = `选区已保存(${clockOf(payload.fromTs)} ~ ${clockOf(payload.toTs)}),已打开提交页`;
    const url = chrome.runtime.getURL('manager/manager.html');
    try {
      chrome.tabs.create({ url });
    } catch {
      window.open(url, '_blank');
    }
  } catch (e) {
    $('rangeInfo').textContent = '设置选区失败: ' + ((e && e.message) || e);
  }
}

init();
