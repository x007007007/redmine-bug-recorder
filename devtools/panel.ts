// DevTools「Bug Recorder」面板:时间轴缩略图(点击定位大步骤/选范围)、大步骤分页列表、
// 选区一键交给提交页。复用 manager/api 与 shared 模块,UI 保持紧凑。

import { send } from '../manager/api';
import { $ } from '../manager/dom';
import { buildPages } from '../shared/timeline';
import { describeAction } from '../shared/describe';
import { renderPages, PAGE_SIZE, clockOf, type PageRow } from './panel-pages';
import type { PageGroup, SessionDetail, StateInfo, SubmitRange } from '../shared/types';

const panelState: {
  recording: boolean;
  sessionId: string | null;
  cache: SessionDetail | null;
  pages: PageGroup[];
  pageIdx: number;
  highlightKey: string | null;
  rangeMode: boolean;
  rangeFromTs: number | null;
  range: SubmitRange | null;
} = {
  recording: false,
  sessionId: null,
  cache: null,
  pages: [],
  pageIdx: 0,
  highlightKey: null,
  rangeMode: false,
  rangeFromTs: null,
  range: null,
};

function init(): void {
  $('btnToggle').addEventListener('click', () => {
    void (async () => {
      const st = await send({ type: 'GET_STATE' });
      await send({ type: st.recording ? 'STOP_RECORDING' : 'START_RECORDING' });
      await refreshState();
    })();
  });
  $('btnOpenMgr').addEventListener('click', () => {
    const url = chrome.runtime.getURL('manager/manager.html');
    try {
      void chrome.tabs.create({ url });
    } catch {
      window.open(url, '_blank');
    }
  });
  $('rangeMode').addEventListener('change', () => {
    panelState.rangeMode = ($('rangeMode') as HTMLInputElement).checked;
    if (!panelState.rangeMode) clearRange();
    else $('rangeInfo').textContent = '依次点击两张截图:第一张为起点,第二张为终点';
  });
  $('btnClearRange').addEventListener('click', clearRange);
  $('btnSubmitRange').addEventListener('click', () => void submitRange());
  $('pgPrev').addEventListener('click', () => setPage(panelState.pageIdx - 1));
  $('pgNext').addEventListener('click', () => setPage(panelState.pageIdx + 1));
  chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
    if (msg && msg.type === 'SESSION_UPDATED') void refreshState();
  });
  void refreshState();
}

async function refreshState(): Promise<void> {
  const st: StateInfo = await send({ type: 'GET_STATE' });
  panelState.recording = st.recording;
  panelState.sessionId = st.sessionId;
  $('dot').classList.toggle('on', st.recording);
  $('recText').textContent = st.recording ? '录制中' : '未录制';
  ($('btnToggle') as HTMLButtonElement).textContent = st.recording ? '■ 停止录制' : '● 开始录制';
  panelState.cache = st.sessionId ? await send({ type: 'GET_SESSION', id: st.sessionId }) : null;
  panelState.pages = panelState.cache
    ? buildPages(panelState.cache.actions, panelState.cache.requests, panelState.cache.pinia)
    : [];
  renderTimeline();
  setPage(0);
}

/* ---------- 时间轴缩略图 ---------- */

function renderTimeline(): void {
  const box = $('timeline');
  box.textContent = '';
  if (!panelState.cache || !panelState.cache.actions.length) {
    box.innerHTML =
      '<div class="empty">开始录制后,每步截图将按时间显示在这里;点击可定位大步骤,选范围后可只提交该范围。</div>';
    return;
  }
  const inRangeTs = (ts: number): boolean =>
    !!panelState.range && ts >= panelState.range.fromTs && ts <= panelState.range.toTs;
  for (const a of panelState.cache.actions) {
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

function onThumbClick(a: { ts: number; screenshot?: string }): void {
  if (panelState.rangeMode) {
    if (panelState.rangeFromTs == null) {
      // 第一下:选起点
      panelState.rangeFromTs = a.ts;
      panelState.range = null;
      $('rangeInfo').textContent = `起点 ${clockOf(a.ts)} 已选,再点击终点截图`;
      $('btnClearRange').hidden = false;
      renderTimeline();
      return;
    }
    // 第二下:起止两点成区间
    const from = Math.min(panelState.rangeFromTs, a.ts);
    const to = Math.max(panelState.rangeFromTs, a.ts);
    panelState.range = { sessionId: panelState.sessionId || '', fromTs: from, toTs: to };
    const n = panelState.cache!.actions.filter((x) => x.ts >= from && x.ts <= to).length;
    $('rangeInfo').textContent = `选区 ${clockOf(from)} ~ ${clockOf(to)}(约 ${n} 步),可按此范围去提交`;
    $('btnSubmitRange').hidden = false;
    renderTimeline();
    return;
  }
  locate(a.ts);
}

/* ---------- 大步骤分页列表 ---------- */

function setPage(idx: number): void {
  const total = Math.max(1, Math.ceil(panelState.pages.length / PAGE_SIZE));
  panelState.pageIdx = Math.min(Math.max(0, idx), total - 1);
  const slice = panelState.pages.slice(panelState.pageIdx * PAGE_SIZE, (panelState.pageIdx + 1) * PAGE_SIZE);
  const rows = renderPages($('pages'), slice, { highlightKey: panelState.highlightKey }) as PageRow[];
  $('pgInfo').textContent = `${panelState.pageIdx + 1} / ${total}`;
  ($('pgPrev') as HTMLButtonElement).disabled = panelState.pageIdx === 0;
  ($('pgNext') as HTMLButtonElement).disabled = panelState.pageIdx >= total - 1;
  return void rows;
}

function locate(ts: number): void {
  const p = panelState.pages.find((x) => ts >= x.startTime && ts <= x.endTime);
  if (!p) return;
  panelState.highlightKey = p.key;
  setPage(Math.floor(panelState.pages.indexOf(p) / PAGE_SIZE));
  const rows = renderPages($('pages'), panelState.pages.slice(panelState.pageIdx * PAGE_SIZE, (panelState.pageIdx + 1) * PAGE_SIZE), {
    highlightKey: panelState.highlightKey,
  }) as PageRow[];
  const row = rows.find((el) => el.__pageKey === p.key);
  if (row && row.__locate) row.__locate();
}

/* ---------- 选区提交 ---------- */

function clearRange(): void {
  panelState.range = null;
  panelState.rangeFromTs = null;
  $('rangeInfo').textContent = panelState.rangeMode
    ? '依次点击两张截图:第一张为起点,第二张为终点'
    : '点击下方截图可定位大步骤';
  $('btnClearRange').hidden = true;
  $('btnSubmitRange').hidden = true;
  renderTimeline();
}

async function submitRange(): Promise<void> {
  if (!panelState.range) {
    $('rangeInfo').textContent = '请先点击起点与终点两张截图';
    return;
  }
  if (!panelState.sessionId) {
    $('rangeInfo').textContent = '会话未就绪(尚未开始录制?),无法设置范围';
    return;
  }
  const payload: SubmitRange = {
    sessionId: panelState.sessionId,
    fromTs: panelState.range.fromTs,
    toTs: panelState.range.toTs,
  };
  // session 区不可用时兜底到 local(两者提交页都能读到)
  const areas = [chrome.storage.session, chrome.storage.local].filter(Boolean);
  try {
    let written = false;
    for (const area of areas) {
      try {
        await area.set({ submitRange: payload });
        const back = (await area.get('submitRange')) as { submitRange?: SubmitRange };
        if (back && back.submitRange) {
          written = true;
          break;
        }
      } catch {
        /* 尝试下一个区域 */
      }
    }
    if (!written) throw new Error('写入后读回为空');
    $('rangeInfo').textContent = `选区已保存(${clockOf(payload.fromTs)} ~ ${clockOf(payload.toTs)}),已打开提交页`;
    const url = chrome.runtime.getURL('manager/manager.html');
    try {
      void chrome.tabs.create({ url });
    } catch {
      window.open(url, '_blank');
    }
  } catch (e) {
    $('rangeInfo').textContent = '设置选区失败: ' + ((e as { message?: string }).message ?? e);
  }
}

init();
