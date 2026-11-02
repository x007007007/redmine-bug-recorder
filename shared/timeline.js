// 统一时间线:把 操作步骤 / API 请求 / Pinia 事件 归入"页面(大步骤)"并按时间交错。
// 页面边界:action 的 url 变化,或 navigate 动作。页面内只按 ts 排序,不再二次分组。
// 首个页面之前产生的请求/事件 → 归入一个前置伪页面(pseudo)。

import { describeAction } from './describe.js';

// 首个页面之前的请求/事件 → 归入一个前置伪页面(pseudo)。
// 输入:actions(按插入序=时间序)、requests / piniaEvents(按 ts 升序)
// 输出:pages 数组(时间正序):
//   { key, orderIndex, pseudo, url, title, tabId, startTime, endTime,
//     actions: [...], entries: [{type:'action'|'request'|'pinia', ts, data, ownerStepIdx}] }
export function buildPages(actions, requests = [], piniaEvents = []) {
  const pages = [];
  let cur = null;
  for (const a of actions) {
    if (!cur || a.url !== cur.url || a.kind === 'navigate') {
      cur = { url: a.url, title: a.title || '', actions: [], startTs: a.ts, tabId: a.tabId };
      pages.push(cur);
    }
    if (a.kind === 'navigate' && !cur.title) cur.title = a.title || '';
    cur.actions.push(a);
  }
  if (!pages.length) {
    pages.push({ url: '(未记录页面)', title: '', actions: [], startTs: 0, pseudo: true });
  }

  // 页面时间窗:[startTs_i, startTs_{i+1}),请求/事件按 ts 归属页面
  const windows = pages.map((p, i) => [p.startTs, i + 1 < pages.length ? pages[i + 1].startTs : Infinity]);
  const pageIndexOf = (ts) => {
    for (let i = pages.length - 1; i >= 0; i--) {
      if (ts >= windows[i][0]) return i;
    }
    return 0;
  };

  const buckets = pages.map(() => []);
  for (const a of actions) buckets[pageIndexOf(a.ts)].push({ type: 'action', ts: a.ts, data: a });
  for (const r of requests) buckets[pageIndexOf(r.ts)].push({ type: 'request', ts: r.ts, data: r });
  for (const ev of piniaEvents) buckets[pageIndexOf(ev.ts)].push({ type: 'pinia', ts: ev.ts, data: ev });

  const TYPE_ORDER = { action: 0, pinia: 1, request: 2 };
  pages.forEach((p, i) => {
    p.entries = buckets[i].sort((x, y) => x.ts - y.ts || TYPE_ORDER[x.type] - TYPE_ORDER[y.type]);
    // 每个 entry 归属到页面内"最近一次 action"(ownerStepIdx),供描述分层
    const acts = p.actions;
    for (const e of p.entries) {
      let idx = -1;
      for (let j = acts.length - 1; j >= 0; j--) {
        if (acts[j].ts <= e.ts) {
          idx = j;
          break;
        }
      }
      e.ownerStepIdx = idx;
    }
    p.startTime = p.entries.length ? p.entries[0].ts : p.startTs;
    p.endTime = p.entries.length ? p.entries[p.entries.length - 1].ts : p.startTs;
  });

  // 前置伪页面:真实页面之前没有任何 action 的桶(仅当其中有请求/事件时保留)
  while (pages.length && pages[0].pseudo && !pages[0].entries.length) pages.shift();
  return pages.map((p, i) => ({
    ...p,
    key: `p${i}`,
    orderIndex: i + 1,
  }));
}

// UI 排序:只调换页面顺序,不动页面内部。mode: 'asc' | 'desc'(默认 desc,最新在前)
export function sortPages(pages, mode = 'desc') {
  const out = [...pages];
  if (mode === 'desc') out.reverse();
  return out;
}

// 搜索过滤:匹配 URL / 标题 / 步骤文案 / API 路径 / Pinia store
export function filterPages(pages, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return pages;
  return pages.filter((p) => {
    if (p.url.toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q)) return true;
    return p.entries.some((e) => entrySearchText(e).toLowerCase().includes(q));
  });
}

function entrySearchText(e) {
  if (e.type === 'action') return describeAction(e.data) + ' ' + (e.data.selector || '');
  if (e.type === 'request') return `${e.data.method} ${e.data.url} ${e.data.status || ''}`;
  return `${e.data.storeId} ${e.data.action || ''} ${(e.data.keys || []).join(' ')}`;
}

// props diff:与上一次出现的同组件对比(输入 actions 需按时间正序)
export function computePropsDiffs(actions) {
  const parse = (json) => {
    try {
      return typeof json === 'string' ? JSON.parse(json) : json;
    } catch {
      return null;
    }
  };
  const lastByComp = new Map();
  const out = new Map();
  for (const a of actions) {
    const comp = a.vue && a.vue.component;
    if (!comp || !a.vue.props) continue;
    const prev = lastByComp.get(comp);
    const changes = [];
    const prevObj = prev ? parse(prev) : null;
    const curObj = parse(a.vue.props);
    if (prevObj && curObj) {
      for (const k of Object.keys(curObj)) {
        if (!(k in prevObj)) changes.push(`${k}: (新增) → ${curObj[k]}`);
        else if (prevObj[k] !== curObj[k]) changes.push(`${k}: ${prevObj[k]} → ${curObj[k]}`);
      }
    }
    out.set(a.id, { changes: changes.slice(0, 8) });
    lastByComp.set(comp, a.vue.props);
  }
  return out;
}

// 截图附件命名:与提交/描述共用同一顺序(actions 数组顺序)
export function assignShotNames(actions) {
  const names = new Map();
  let n = 0;
  for (const a of actions) {
    if (a.screenshot) names.set(a.id, `step-${String(++n).padStart(2, '0')}.jpg`);
  }
  return names;
}

// 跨标签页展示:按首次出现顺序给 tabId 编号
export function buildTabLabels(actions) {
  const map = new Map();
  for (const a of actions) {
    if (a.tabId != null && !map.has(a.tabId)) map.set(a.tabId, map.size + 1);
  }
  return map; // tabId -> 1..n
}
