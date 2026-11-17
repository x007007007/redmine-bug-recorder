// 导出 CSV(Excel 可直接打开):操作 / API / Pinia 按时间交错,截图列含 base64 编码。

import { fmtClock, describeAction, describeElement, describeLog, describePiniaEvent, shortUrl, clip } from '../shared/describe';
import { t } from '../shared/i18n';
import { buildPages } from '../shared/timeline';
import type { ChangeNote, LogEntry, PageGroup, PiniaEvent, RecordedAction, RequestEntry, SessionDetail, TimelineEntry } from '../shared/types';

function headers(): string[] {
  return [
    t('csvTime'),
    t('csvStepCol'),
    t('csvType'),
    t('csvContent'),
    t('csvComponent'),
    t('csvSelector'),
    t('csvValue'),
    t('csvStatus'),
    t('csvPage'),
    t('csvShot'),
  ];
}

export function buildCsv(cache: SessionDetail): string {
  const pages = buildPages(cache.actions, cache.requests, cache.pinia, cache.logs, cache.notes || []);
  const lines: string[][] = [headers()];
  for (const p of pages) {
    const stepNumMap = stepNumbers(p);
    for (const e of p.entries) {
      lines.push(csvRow(p, e as TimelineEntry, stepNumMap));
    }
  }
  return lines.map((row) => row.map(escapeCsv).join(',')).join('\r\n');
}

function stepNumbers(p: PageGroup): Map<number, number> {
  const nav = p.actions.find((a) => a.kind === 'navigate');
  let n = 0;
  const numOf = new Map<number, number>();
  for (const a of p.actions) {
    if (a.kind === 'navigate' && a === nav) continue;
    numOf.set(a.id!, ++n);
  }
  return numOf;
}

function csvRow(p: PageGroup, e: TimelineEntry, numOf: Map<number, number>): string[] {
  const ts = fmtClock(e.ts);
  const page = p.pseudo ? t('csvBefore') : `#${p.orderIndex} ${shortUrl(p.url, 60)}`;
  const stepCol = e.type === 'action' && numOf.has(e.data.id!) ? t('csvStep', String(numOf.get(e.data.id!))) : '';
  const tail: string[] = [ts, stepCol];
  const body = CSV_ROW_BY_TYPE[e.type]?.(e.data, page) ?? [];
  return [...tail, ...body];
}

type CsvBody = (data: TimelineEntry['data'], page: string) => string[];

/** 各类条目的 [类型, 内容, 组件, 选择器, 值, 状态] 片段;页尾两列由调用方拼 */
const CSV_ROW_BY_TYPE: Record<TimelineEntry['type'], CsvBody> = {
  action: (data, page) => {
    const a = data as RecordedAction;
    return [
      t('csvAction'),
      describeAction(a),
      (a.vue && a.vue.component) || '',
      a.selector || '',
      clip(String(a.value || a.href || ''), 300),
      '',
      page,
      shotBase64(a),
    ];
  },
  request: (data, page) => {
    const r = data as RequestEntry;
    return [
      'API',
      `${r.method} ${shortUrl(r.url, 100)}`,
      '',
      '',
      clip(String(r.requestBody || ''), 500),
      r.error ? t('csvError', r.error) : `${r.status || '?'}${r.durationMs != null ? ' / ' + r.durationMs + 'ms' : ''}`,
      page,
      '',
    ];
  },
  log: (data, page) => {
    const l = data as LogEntry;
    return ['Console', describeLog(l), '', '', '', l.level, page, ''];
  },
  note: (data, page) => {
    const n = data as ChangeNote;
    return [t('csvNote'), `${describeElement(n)} → ${n.opinion}`, '', n.selector, n.opinion, '', page, ''];
  },
  pinia: (data, page) => ['Pinia', describePiniaEvent(data as PiniaEvent), '', '', '', '', page, ''],
};

function shotBase64(a: { screenshot?: string }): string {
  if (!a.screenshot) return '';
  const comma = a.screenshot.indexOf(',');
  return comma >= 0 ? a.screenshot.slice(comma + 1) : a.screenshot;
}

function escapeCsv(v: unknown): string {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
