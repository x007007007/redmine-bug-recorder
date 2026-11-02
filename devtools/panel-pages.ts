// 大步骤分页列表渲染(供 panel.ts 调用)。

import { esc, shortenUrl } from '../manager/dom';
import { describeAction, describePiniaEvent } from '../shared/describe';
import type { PageGroup } from '../shared/types';

export const PAGE_SIZE = 5;

export interface PageRow extends HTMLDivElement {
  __locate?: () => void;
  __pageKey?: string;
}

export function clockOf(ts: number): string {
  const d = new Date(ts);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function renderPages(
  container: HTMLElement,
  rows: PageGroup[],
  opts: { highlightKey: string | null }
): PageRow[] {
  container.textContent = '';
  if (!rows.length) {
    container.innerHTML = '<div class="empty" style="color:#5f6368;padding:12px;">暂无大步骤</div>';
    return [];
  }
  const out: PageRow[] = [];
  for (const p of rows) {
    const row = buildRow(p, opts.highlightKey);
    container.appendChild(row);
    out.push(row);
  }
  return out;
}

function buildRow(p: PageGroup, highlightKey: string | null): PageRow {
  const row = document.createElement('div') as PageRow;
  row.className = 'page-row' + (p.key === highlightKey ? ' hl' : '');
  row.__pageKey = p.key;

  const head = document.createElement('div');
  head.className = 'head';
  const clock = `${clockOf(p.startTime)}${p.endTime > p.startTime ? ' ~ ' + clockOf(p.endTime) : ''}`;
  const apiCount = p.entries.filter((e) => e.type === 'request').length;
  head.innerHTML =
    `<span class="u">📄 大步骤 ${p.orderIndex} · ${esc(shortenUrl(p.url, 70))}</span>` +
    `<span class="m">${clock} · ${p.actions.length} 步 / ${apiCount} API · 点击展开明细</span>`;
  head.addEventListener('click', () => row.classList.toggle('open'));
  row.appendChild(head);

  const entries = document.createElement('div');
  entries.className = 'entries';
  for (const e of p.entries) {
    const div = document.createElement('div');
    div.className = 'en' + (e.type === 'request' ? ' req' : e.type === 'pinia' ? ' pin' : '');
    div.textContent =
      clockOf(e.ts) + ' ' +
      (e.type === 'action'
        ? describeAction(e.data)
        : e.type === 'request'
          ? `API ${e.data.method} ${shortenUrl(e.data.url, 60)} → ${e.data.error || e.data.status || '?'}`
          : 'Pinia ' + describePiniaEvent(e.data));
    entries.appendChild(div);
  }
  row.appendChild(entries);

  row.__locate = () => {
    row.scrollIntoView({ block: 'nearest' });
    row.classList.add('open');
  };
  return row;
}
