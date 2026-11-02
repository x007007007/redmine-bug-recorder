// 大步骤分页列表渲染(供 panel.js 调用)。

import { esc, shortenUrl } from '../manager/dom.js';
import { describeAction, describePiniaEvent } from '../shared/describe.js';

export const PAGE_SIZE = 5;

// rows: [{key, orderIndex, url, title, startTime, endTime, tabLabel, actions, entries}]
export function renderPages(container, rows, { highlightKey, onLocate }) {
  container.textContent = '';
  if (!rows.length) {
    container.innerHTML = '<div class="empty" style="color:#5f6368;padding:12px;">暂无大步骤</div>';
    return;
  }
  for (const p of rows) {
    container.appendChild(buildRow(p, highlightKey, onLocate));
  }
}

function buildRow(p, highlightKey, onLocate) {
  const row = document.createElement('div');
  row.className = 'page-row' + (p.key === highlightKey ? ' hl' : '');
  row.dataset.key = p.key;

  const head = document.createElement('div');
  head.className = 'head';
  const clock = `${clockOf(p.startTime)}${p.endTime > p.startTime ? ' ~ ' + clockOf(p.endTime) : ''}`;
  const apiCount = p.entries.filter((e) => e.type === 'request').length;
  head.innerHTML =
    `<span class="u">📄 大步骤 ${p.orderIndex} · ${esc(shortenUrl(p.url, 70))}</span>` +
    `<span class="m">${clock}${p.tabLabel ? ' · ' + esc(p.tabLabel) : ''} · ${p.actions.length} 步 / ${apiCount} API · 点击展开明细</span>`;
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

  // 供定位:点击头部时滚动入口
  row.__locate = () => {
    row.scrollIntoView({ block: 'nearest' });
    row.classList.add('open');
  };
  row.__pageKey = p.key;
  if (onLocate) onLocate(row);
  return row;
}

export function clockOf(ts) {
  const d = new Date(ts);
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
