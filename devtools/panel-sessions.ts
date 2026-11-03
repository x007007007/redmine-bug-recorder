// 面板 · 会话列表:切换查看 / 删除历史会话。

import { fmtTime } from '../shared/describe';
import type { SessionSummary } from '../shared/types';

export interface SessionListOpts {
  currentId: string | null;
  activeId: string | null;
  pendingDeleteId: string | null;
  onSelect: (id: string) => void;
  onAskDelete: (id: string) => void;
  onCancelDelete: () => void;
  onDelete: (id: string) => void;
}

export function renderSessions(container: HTMLElement, sessions: SessionSummary[], opts: SessionListOpts): void {
  container.textContent = '';
  if (!sessions.length) {
    container.innerHTML = '<div class="empty" style="color:#5f6368;padding:8px;">暂无会话,点上方「开始录制」</div>';
    return;
  }
  for (const s of sessions) {
    container.appendChild(buildItem(s, opts));
  }
}

function buildItem(s: SessionSummary, opts: SessionListOpts): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'session-item' + (s.id === opts.currentId ? ' sel' : '');
  row.dataset.id = s.id;
  row.dataset.count = String(s.actionCount);

  const main = document.createElement('span');
  main.className = 'si-main';
  const statusText =
    { recording: '录制中', stopped: '已停止', submitted: `已提交#${s.issueId || ''}` }[s.status] || s.status;
  const when = document.createElement('b');
  when.textContent = fmtTime(s.startedAt).slice(5);
  const meta = document.createElement('span');
  meta.className = 'm';
  meta.textContent = ` ${statusText} · ${s.actionCount}步/${s.requestCount}API${s.logCount ? `/${s.logCount}Console` : ''}`;
  main.append(when);
  if (s.id === opts.activeId) {
    const live = document.createElement('span');
    live.className = 'live';
    live.textContent = '● LIVE';
    main.append(document.createTextNode(' '), live);
  }
  main.append(meta);
  main.title = '点击切换到该会话';
  main.addEventListener('click', () => opts.onSelect(s.id));

  row.append(main, buildDelete(s.id, opts));
  return row;
}

function buildDelete(id: string, opts: SessionListOpts): HTMLElement {
  if (opts.pendingDeleteId !== id) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'si-del';
    del.textContent = '✕';
    del.title = '删除该会话(含截图/记录)';
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      opts.onAskDelete(id);
    });
    return del;
  }
  const box = document.createElement('span');
  box.className = 'si-confirm';
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'si-del-ok';
  ok.textContent = '删除';
  ok.title = '确认删除该会话';
  ok.addEventListener('click', (ev) => {
    ev.stopPropagation();
    opts.onDelete(id);
  });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'si-del-no';
  cancel.textContent = '取消';
  cancel.addEventListener('click', (ev) => {
    ev.stopPropagation();
    opts.onCancelDelete();
  });
  box.append(ok, cancel);
  return box;
}
