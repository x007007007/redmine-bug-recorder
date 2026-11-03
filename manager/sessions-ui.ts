// 会话列表:渲染 / 选择 / 删除。

import { send } from './api';
import { $, esc, showError } from './dom';
import { store } from './store';
import { fmtTime } from '../shared/describe';
import { t } from '../shared/i18n';
import { renderAll } from './steps-ui';
import { issueLinksOf, prefillForm } from './report-ui';
import { readPendingRange, applyScope, renderScopeBanner } from './range';
import { loadSelection } from './selection';
import type { RecorderSession, SessionSummary } from '../shared/types';

export async function refreshSessions(): Promise<void> {
  store.sessions = (await send({ type: 'LIST_SESSIONS' })) as unknown as (RecorderSession & { actionCount?: number })[];
  const box = $('sessions');
  box.textContent = '';
  for (const s of store.sessions as unknown as SessionSummary[]) {
    box.appendChild(buildSessionItem(s));
  }
  if (!(store.sessions as unknown as SessionSummary[]).length) {
    const empty = document.createElement('div');
    empty.style.padding = '16px';
    empty.style.color = '#80868b';
    empty.style.fontSize = '12px';
    empty.textContent = t('sessionsEmpty');
    box.appendChild(empty);
  }
}

function buildSessionItem(s: SessionSummary): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'session' + (s.id === store.currentId ? ' sel' : '');
  div.dataset.id = s.id;

  const when = document.createElement('div');
  when.className = 't';
  when.textContent = fmtTime(s.startedAt);

  const links = issueLinksOf(s);
  const sub = document.createElement('div');
  sub.className = 's';
  const chip = document.createElement('span');
  const issueId = String(s.issueId || links[0]?.issueId || '');
  const submittedText = links.length > 1 ? t('stateSubmittedCount', String(links.length)) : t('stateSubmittedId', issueId);
  const statusText = { recording: t('stateRecording'), stopped: t('stateStopped'), submitted: submittedText }[s.status] || s.status;
  chip.className = `status-chip status-${s.status}`;
  chip.textContent = statusText;
  sub.append(
    chip,
    document.createTextNode(
      t('sessionStats', [
        String(s.actionCount),
        String(s.requestCount),
        s.logCount ? t('sessionConsole', String(s.logCount)) : '',
        s.piniaCount ? t('sessionPinia', String(s.piniaCount)) : '',
      ])
    )
  );
  const issues = document.createElement('div');
  issues.className = 'session-issues';
  for (const link of [...links].reverse()) {
    const anchor = document.createElement('a');
    anchor.href = link.issueUrl;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer';
    const subject = link.subject ? ` ${link.subject.slice(0, 24)}` : '';
    anchor.textContent = `#${link.issueId}${subject}`;
    anchor.title = link.issueUrl;
    anchor.addEventListener('click', (ev) => ev.stopPropagation());
    issues.appendChild(anchor);
  }

  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = '✕';
  del.title = t('deleteSessionShort');
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    void (async () => {
      if (!confirm(t('confirmDelete'))) return;
      await send({ type: 'DELETE_SESSION', id: s.id });
      if (store.currentId === s.id) {
        store.currentId = null;
        store.cache = null;
        store.full = null;
        store.scope = null;
        setDetailVisible(false);
        renderAll();
      }
      void refreshSessions();
    })();
  });

  div.append(when, sub);
  if (links.length) div.appendChild(issues);
  div.appendChild(del);
  div.addEventListener('click', () => void selectSession(s.id));
  return div;
}

export async function selectSession(id: string): Promise<void> {
  store.currentId = id;
  store.subjectDirty = false;
  store.descDirty = false;
  $('submitResult').textContent = '';
  document.querySelectorAll('.session').forEach((el) => el.classList.toggle('sel', (el as HTMLElement).dataset.id === id));
  try {
    const full = await send({ type: 'GET_SESSION', id });
    const range = await readPendingRange(id);
    const { cache, scope } = applyScope(full, range, store.fullScope);
    store.full = full;
    store.cache = cache;
    store.scope = scope;
  } catch (e) {
    store.cache = null;
    store.scope = null;
    showError(e);
    return;
  }
  // 默认全选(缺历史勾选时),review 时可取消;与 DevTools 面板共享同一份勾选
  store.selected = await loadSelection(id, store.cache!.actions);
  setDetailVisible(true);
  renderAll();
  renderScopeBanner();
  prefillForm();
}

function setDetailVisible(has: boolean): void {
  $('sessionDetail').hidden = !has;
  $('noSession').hidden = has;
  $('submitDock').hidden = !has;
}

export { esc };
