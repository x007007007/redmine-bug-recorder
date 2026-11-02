// 统一时间线:把 操作步骤 / API 请求 / Pinia 事件 归入"页面(大步骤)"并按时间交错。
// 页面边界:action 的 url 变化,或 navigate 动作。页面内只按 ts 排序,不再二次分组。

import type { PageGroup, PiniaEvent, RecordedAction, RequestEntry, TimelineEntry } from './types';
import { describeAction } from './describe';

type PageRaw = {
  url: string;
  title: string;
  actions: RecordedAction[];
  startTs: number;
  tabId?: number | null;
  pseudo?: boolean;
  entries?: TimelineEntry[];
  startTime?: number;
  endTime?: number;
};

/** 首个页面之前的请求/事件归入前置伪页面(pseudo)。actions 按插入序=时间序,requests/piniaEvents 按 ts 升序 */
export function buildPages(
  actions: RecordedAction[],
  requests: RequestEntry[] = [],
  piniaEvents: PiniaEvent[] = []
): PageGroup[] {
  const pages: PageRaw[] = [];
  let cur: PageRaw | null = null;
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
  const windows = pages.map((p, i) => [p.startTs, i + 1 < pages.length ? pages[i + 1]!.startTs : Infinity] as const);
  const pageIndexOf = (ts: number): number => {
    for (let i = pages.length - 1; i >= 0; i--) {
      if (ts >= windows[i]![0]) return i;
    }
    return 0;
  };

  const buckets: TimelineEntry[][] = pages.map(() => []);
  for (const a of actions) buckets[pageIndexOf(a.ts)]!.push({ type: 'action', ts: a.ts, data: a, ownerStepIdx: -1 });
  for (const r of requests) buckets[pageIndexOf(r.ts)]!.push({ type: 'request', ts: r.ts, data: r, ownerStepIdx: -1 });
  for (const ev of piniaEvents) buckets[pageIndexOf(ev.ts)]!.push({ type: 'pinia', ts: ev.ts, data: ev, ownerStepIdx: -1 });

  const TYPE_ORDER: Record<TimelineEntry['type'], number> = { action: 0, pinia: 1, request: 2 };
  pages.forEach((p, i) => {
    const entries = buckets[i]!.sort((x, y) => x.ts - y.ts || TYPE_ORDER[x.type] - TYPE_ORDER[y.type]);
    // 每个 entry 归属到页面内"最近一次 action"(ownerStepIdx)
    const acts = p.actions;
    for (const e of entries) {
      let idx = -1;
      for (let j = acts.length - 1; j >= 0; j--) {
        if (acts[j]!.ts <= e.ts) {
          idx = j;
          break;
        }
      }
      e.ownerStepIdx = idx;
    }
    p.entries = entries;
    p.startTime = entries.length ? entries[0]!.ts : p.startTs;
    p.endTime = entries.length ? entries[entries.length - 1]!.ts : p.startTs;
  });

  // 前置伪页面:没有条目时丢弃
  while (pages.length && pages[0]!.pseudo && !pages[0]!.entries!.length) pages.shift();
  return pages.map((p, i) => ({
    ...p,
    key: `p${i}`,
    orderIndex: i + 1,
    entries: p.entries ?? [],
    startTime: p.startTime ?? p.startTs,
    endTime: p.endTime ?? p.startTs,
  }));
}

/** UI 排序:只调换页面顺序,不动页面内部。mode: 'asc' | 'desc'(默认 desc,最新在前) */
export function sortPages(pages: PageGroup[], mode: 'asc' | 'desc' = 'desc'): PageGroup[] {
  const out = [...pages];
  if (mode === 'desc') out.reverse();
  return out;
}

function entrySearchText(e: TimelineEntry): string {
  if (e.type === 'action') return describeAction(e.data) + ' ' + (e.data.selector || '');
  if (e.type === 'request') return `${e.data.method} ${e.data.url} ${e.data.status ?? ''}`;
  return `${e.data.storeId} ${e.data.action || ''} ${(e.data.keys || []).join(' ')}`;
}

/** 搜索过滤:匹配 URL / 标题 / 步骤文案 / API 路径 / Pinia store */
export function filterPages(pages: PageGroup[], query: string): PageGroup[] {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return pages;
  return pages.filter((p) => {
    if (p.url.toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q)) return true;
    return p.entries.some((e) => entrySearchText(e).toLowerCase().includes(q));
  });
}

/** props diff:与上一次出现的同组件对比(输入 actions 需按时间正序) */
export function computePropsDiffs(actions: RecordedAction[]): Map<number | undefined, { changes: string[] }> {
  const parse = (json: string | null): Record<string, string> | null => {
    try {
      return typeof json === 'string' ? JSON.parse(json) : null;
    } catch {
      return null;
    }
  };
  const lastByComp = new Map<string, string | null>();
  const out = new Map<number | undefined, { changes: string[] }>();
  for (const a of actions) {
    const vue = a.vue;
    const comp = vue && vue.component;
    if (!comp || !vue || !vue.props) continue;
    const prev = lastByComp.get(comp);
    const changes: string[] = [];
    const prevObj = prev ? parse(prev) : null;
    const curObj = parse(vue.props);
    if (prevObj && curObj) {
      for (const k of Object.keys(curObj)) {
        if (!(k in prevObj)) changes.push(`${k}: (新增) → ${curObj[k]}`);
        else if (prevObj[k] !== curObj[k]) changes.push(`${k}: ${prevObj[k]} → ${curObj[k]}`);
      }
    }
    out.set(a.id, { changes: changes.slice(0, 8) });
    lastByComp.set(comp, vue.props);
  }
  return out;
}

/** 跨标签页展示:按首次出现顺序给 tabId 编号 */
export function buildTabLabels(actions: RecordedAction[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const a of actions) {
    if (a.tabId != null && !map.has(a.tabId)) map.set(a.tabId, map.size + 1);
  }
  return map;
}
