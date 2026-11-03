// 大步骤分页列表渲染(供 panel.ts 调用)。

import { entryVisible, type CaptureView, type ListOrigin } from '../shared/timeline';
import { esc, shortenUrl } from '../manager/dom';
import { describeAction, describeElement, describeLog, describePiniaEvent } from '../shared/describe';
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

export interface PageRenderOpts {
  highlightKey: string | null;
  /** 勾选集合(缺失视为全选之后的具体 id 集) */
  isSelected: (id: number) => boolean;
  onTogglePage: (p: PageGroup, checked: boolean) => void;
  listOrigin: ListOrigin;
  captureView: CaptureView;
}

export function renderPages(container: HTMLElement, rows: PageGroup[], opts: PageRenderOpts): PageRow[] {
  container.textContent = '';
  if (!rows.length) {
    container.innerHTML = '<div class="empty" style="color:#5f6368;padding:12px;">当前过滤下没有条目</div>';
    return [];
  }
  const out: PageRow[] = [];
  for (const p of rows) {
    const row = buildRow(p, opts);
    container.appendChild(row);
    out.push(row);
  }
  return out;
}

function buildRow(p: PageGroup, opts: PageRenderOpts): PageRow {
  const row = document.createElement('div') as PageRow;
  row.className = 'page-row' + (p.key === opts.highlightKey ? ' hl' : '');
  row.__pageKey = p.key;

  const head = document.createElement('div');
  head.className = 'head';

  // 大步骤勾选:勾上=该页全部步骤(含截图)纳入提交
  const real = p.actions.filter((a) => typeof a.id === 'number');
  const selCount = real.filter((a) => opts.isSelected(a.id!)).length;
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'page-cb';
  cb.checked = real.length > 0 && selCount === real.length;
  cb.indeterminate = selCount > 0 && selCount < real.length;
  cb.disabled = real.length === 0;
  cb.title = `勾选该页全部步骤(共 ${real.length} 步,当前已选 ${selCount})`;
  cb.addEventListener('click', (e) => e.stopPropagation());
  cb.addEventListener('change', () => opts.onTogglePage(p, cb.checked));
  head.appendChild(cb);

  const clock = `${clockOf(p.startTime)}${p.endTime > p.startTime ? ' ~ ' + clockOf(p.endTime) : ''}`;
  const apiCount = p.entries.filter((e) => e.type === 'request').length;
  const logCount = p.entries.filter((e) => e.type === 'log').length;
  const title = document.createElement('span');
  title.className = 'titles';
  title.innerHTML =
    `<span class="u">📄 大步骤 ${p.orderIndex} · ${esc(shortenUrl(p.url, 70))}</span>` +
    `<span class="m">${clock} · ${p.actions.length} 步 / ${apiCount} API${logCount ? ` / ${logCount} Console` : ''} · 已选 ${selCount}/${real.length} · 点击展开明细</span>`;
  title.addEventListener('click', () => row.classList.toggle('open'));
  head.appendChild(title);
  row.appendChild(head);

  const entries = document.createElement('div');
  entries.className = 'entries';
  for (const e of p.entries) {
    if (!entryVisible(e, opts.listOrigin, opts.captureView)) continue;
    const div = document.createElement('div');
    div.className =
      'en' +
      (e.type === 'request'
        ? ' req'
        : e.type === 'pinia'
          ? ' pin'
          : e.type === 'log'
            ? e.data.level === 'warning'
              ? ' log warn'
              : e.data.level === 'error'
                ? ' log err'
                : ' log info'
            : e.type === 'note'
              ? ' note'
              : '');
    div.textContent =
      clockOf(e.ts) +
      ' ' +
      (e.type === 'action'
        ? describeAction(e.data)
        : e.type === 'request'
          ? `API ${e.data.method} ${shortenUrl(e.data.url, 60)} → ${e.data.error || e.data.status || '?'}`
          : e.type === 'log'
            ? describeLog(e.data)
            : e.type === 'note'
              ? `修改意见 ${describeElement(e.data)} → ${e.data.opinion}`
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
