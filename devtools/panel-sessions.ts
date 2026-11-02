// 面板 · 会话列表:切换查看 / 删除历史会话。

import { esc } from '../manager/dom';
import { fmtTime } from '../shared/describe';
import type { SessionSummary } from '../shared/types';

export function renderSessions(
  container: HTMLElement,
  sessions: SessionSummary[],
  opts: { currentId: string | null; activeId: string | null; onSelect: (id: string) => void; onDelete: (id: string) => void }
): void {
  container.textContent = '';
  if (!sessions.length) {
    container.innerHTML = '<div class="empty" style="color:#5f6368;padding:8px;">暂无会话,点上方「开始录制」</div>';
    return;
  }
  for (const s of sessions) {
    container.appendChild(buildItem(s, opts));
  }
}

function buildItem(
  s: SessionSummary,
  opts: { currentId: string | null; activeId: string | null; onSelect: (id: string) => void; onDelete: (id: string) => void }
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'session-item' + (s.id === opts.currentId ? ' sel' : '');
  row.dataset.id = s.id;
  row.dataset.count = String(s.actionCount);

  const main = document.createElement('span');
  main.className = 'si-main';
  const statusText =
    { recording: '录制中', stopped: '已停止', submitted: `已提交#${s.issueId || ''}` }[s.status] || s.status;
  main.innerHTML =
    `<b>${esc(fmtTime(s.startedAt).slice(5))}</b>` +
    (s.id === opts.activeId ? ' <span class="live">● LIVE</span>' : '') +
    `<span class="m"> ${statusText} · ${s.actionCount}步/${s.requestCount}API</span>`;
  main.title = '点击切换到该会话';
  main.addEventListener('click', () => opts.onSelect(s.id));

  const del = document.createElement('button');
  del.className = 'si-del';
  del.textContent = '✕';
  del.title = '删除该会话(含截图/记录)';
  del.addEventListener('click', () => opts.onDelete(s.id));

  row.append(main, del);
  return row;
}
