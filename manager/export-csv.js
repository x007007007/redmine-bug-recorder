// 导出 CSV(Excel 可直接打开):操作 / API / Pinia 按时间交错,截图列含 base64 编码。

import { fmtClock, describeAction, describePiniaEvent, shortUrl, clip } from '../shared/describe.js';
import { buildPages } from '../shared/timeline.js';

const HEADERS = ['时间', '大步骤', '类型', '内容', 'Vue组件', '选择器', '值/请求体', '状态/耗时', '页面', '截图base64'];

export function buildCsv(cache) {
  const pages = buildPages(cache.actions, cache.requests, cache.pinia);
  const lines = [HEADERS];
  for (const p of pages) {
    const stepNumMap = stepNumbers(p);
    for (const e of p.entries) {
      lines.push(csvRow(p, e, stepNumMap));
    }
  }
  return lines.map((row) => row.map(escapeCsv).join(',')).join('\r\n');
}

function stepNumbers(p) {
  const nav = p.actions.find((a) => a.kind === 'navigate');
  let n = 0;
  const numOf = new Map();
  for (const a of p.actions) {
    if (a.kind === 'navigate' && a === nav) continue;
    numOf.set(a.id, ++n);
  }
  return numOf;
}

function csvRow(p, e, numOf) {
  const ts = fmtClock(e.ts);
  const page = p.pseudo ? '(前置)' : `#${p.orderIndex} ${shortUrl(p.url, 60)}`;
  const stepCol = e.type === 'action' && numOf.has(e.data.id) ? `步骤${numOf.get(e.data.id)}` : '';
  if (e.type === 'action') {
    const a = e.data;
    return [
      ts,
      stepCol,
      '操作',
      describeAction(a),
      (a.vue && a.vue.component) || '',
      a.selector || '',
      clip(String(a.value || a.href || ''), 300),
      '',
      page,
      shotBase64(a),
    ];
  }
  if (e.type === 'request') {
    const r = e.data;
    return [
      ts,
      '',
      'API',
      `${r.method} ${shortUrl(r.url, 100)}`,
      '',
      '',
      clip(String(r.requestBody || ''), 500),
      r.error ? `错误:${r.error}` : `${r.status || '?'}${r.durationMs != null ? ' / ' + r.durationMs + 'ms' : ''}`,
      page,
      '',
    ];
  }
  return [ts, '', 'Pinia', describePiniaEvent(e.data), '', '', '', '', page, ''];
}

function shotBase64(a) {
  if (!a.screenshot) return '';
  const comma = a.screenshot.indexOf(',');
  return comma >= 0 ? a.screenshot.slice(comma + 1) : a.screenshot;
}

function escapeCsv(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
