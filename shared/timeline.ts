// 统一时间线:把 操作步骤 / API 请求 / Pinia / Console 归入"页面(大步骤)"并按时间交错。
// 页面边界只看地址是否变化。同一次打开里重复的「跳转到同一地址」不另开大步骤。

import { describeAction } from './describe';
import { t } from './i18n';
import type { ChangeNote, LogEntry, PageGroup, PiniaEvent, RecordedAction, RequestEntry, TimelineEntry } from './types';

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

/** 比较用地址:去掉 hash,避免同一页的锚点或重复加载被拆开 */
export function pageUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.origin + u.pathname + u.search;
  } catch {
    return url;
  }
}

/** 首个页面之前的请求/事件归入前置伪页面(pseudo)。actions 按插入序=时间序,requests/piniaEvents 按 ts 升序 */
export function buildPages(
  actions: RecordedAction[],
  requests: RequestEntry[] = [],
  piniaEvents: PiniaEvent[] = [],
  logs: LogEntry[] = [],
  notes: ChangeNote[] = []
): PageGroup[] {
  const pages: PageRaw[] = [];
  let cur: PageRaw | null = null;
  for (const a of actions) {
    const url = pageUrl(a.url);
    const samePage = !!cur && pageUrl(cur.url) === url;
    if (a.kind === 'navigate' && samePage) continue;
    if (!cur || !samePage) {
      cur = { url: a.url, title: a.title || '', actions: [], startTs: a.ts, tabId: a.tabId };
      pages.push(cur);
    }
    if (a.kind === 'navigate' && !cur.title) cur.title = a.title || '';
    cur.actions.push(a);
  }
  if (!pages.length) {
    pages.push({ url: t('unrecordedPage'), title: '', actions: [], startTs: 0, pseudo: true });
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
  for (const log of logs) buckets[pageIndexOf(log.ts)]!.push({ type: 'log', ts: log.ts, data: log, ownerStepIdx: -1 });
  for (const note of notes) buckets[pageIndexOf(note.ts)]!.push({ type: 'note', ts: note.ts, data: note, ownerStepIdx: -1 });

  const TYPE_ORDER: Record<TimelineEntry['type'], number> = { action: 0, note: 1, pinia: 2, log: 3, request: 4 };
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

/** 事件归属到「不晚于它的最后一条步骤」。只留下归属步骤已被勾选的事件。 */
export function ownedBySelection<T extends { ts: number }>(
  actions: RecordedAction[],
  selectedIds: Set<number>,
  items: T[]
): T[] {
  const sorted = actions.filter((a) => typeof a.id === 'number').sort((a, b) => a.ts - b.ts || a.id! - b.id!);
  return items.filter((item) => {
    let owner: number | null = null;
    for (const a of sorted) {
      if (a.ts <= item.ts) owner = a.id!;
      else break;
    }
    return owner != null && selectedIds.has(owner);
  });
}

/** UI 排序:按大步骤开始时间排,不动页面内部。mode: 'asc' 时间正序 | 'desc' 最新在前 */
export function sortPages(pages: PageGroup[], mode: 'asc' | 'desc' = 'desc'): PageGroup[] {
  const out = [...pages].sort((a, b) => a.startTime - b.startTime || a.orderIndex - b.orderIndex);
  if (mode === 'desc') out.reverse();
  return out;
}

function entrySearchText(e: TimelineEntry): string {
  if (e.type === 'action') return describeAction(e.data) + ' ' + (e.data.selector || '');
  if (e.type === 'request') return `${e.data.method} ${e.data.url} ${e.data.status ?? ''}`;
  if (e.type === 'log') return `${e.data.level} ${e.data.text}`;
  if (e.type === 'note') return `${e.data.opinion} ${e.data.selector} ${e.data.htmlHint}`;
  return `${e.data.storeId} ${e.data.action || ''} ${(e.data.keys || []).join(' ')}`;
}

export type ListOrigin = 'all' | 'human' | 'event';

/** 人填写的是修改意见;其余是自动记下的事件 */
export function isHumanEntry(entry: TimelineEntry): boolean {
  return entry.type === 'note';
}

export function entryMatchesOrigin(entry: TimelineEntry, origin: ListOrigin = 'all'): boolean {
  if (origin === 'all') return true;
  return isHumanEntry(entry) === (origin === 'human');
}

/** 大步骤里按捕获类别显示。勾选的类别取并集;全部勾上时导航步骤也显示。 */
export interface CaptureView {
  isClickShown: boolean;
  isKeyboardShown: boolean;
  isShotShown: boolean;
  isVueShown: boolean;
  isConsoleShown: boolean;
  isRequestShown: boolean;
}

export const SHOW_ALL_CAPTURE: CaptureView = {
  isClickShown: true,
  isKeyboardShown: true,
  isShotShown: true,
  isVueShown: true,
  isConsoleShown: true,
  isRequestShown: true,
};

function captureNarrowed(view: CaptureView): boolean {
  return !view.isClickShown || !view.isKeyboardShown || !view.isShotShown || !view.isVueShown || !view.isConsoleShown || !view.isRequestShown;
}

export function entryMatchesCapture(entry: TimelineEntry, view: CaptureView = SHOW_ALL_CAPTURE): boolean {
  if (entry.type === 'log') return view.isConsoleShown;
  if (entry.type === 'request') return view.isRequestShown;
  if (entry.type === 'pinia') return view.isVueShown;
  if (entry.type === 'note') return true;
  if (entry.type !== 'action') return true;
  const action = entry.data;
  if (action.kind === 'navigate') return !captureNarrowed(view) || !!(action.screenshot && view.isShotShown);
  if (action.kind === 'click' && view.isClickShown) return true;
  if ((action.kind === 'input' || action.kind === 'keypress' || action.kind === 'submit') && view.isKeyboardShown) return true;
  if (action.screenshot && view.isShotShown) return true;
  if (action.vue && action.vue.component && view.isVueShown) return true;
  return false;
}

export function entryVisible(entry: TimelineEntry, origin: ListOrigin, view: CaptureView): boolean {
  return entryMatchesOrigin(entry, origin) && entryMatchesCapture(entry, view);
}

/** 没有匹配条目的页面不显示。页面对象仍保留全部条目,避免过滤时误删。 */
export function filterByOrigin(pages: PageGroup[], origin: ListOrigin = 'all'): PageGroup[] {
  if (origin === 'all') return pages;
  return pages.filter((page) => page.entries.some((entry) => entryMatchesOrigin(entry, origin)));
}

export function filterVisiblePages(pages: PageGroup[], origin: ListOrigin, view: CaptureView): PageGroup[] {
  return pages.filter((page) => page.entries.some((entry) => entryVisible(entry, origin, view)));
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
        if (!(k in prevObj)) changes.push(`${k}: ${t('added')} → ${curObj[k]}`);
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
