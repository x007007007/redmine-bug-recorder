// Bug 表单:描述生成(仅勾选步骤)/ 重新生成 / 复制 / 提交 Redmine / 导出 JSON 与 CSV。

import { send } from './api';
import { $, showError } from './dom';
import { store } from './store';
import { buildDescription } from '../shared/report';
import { ownedBySelection } from '../shared/timeline';
import { buildSubject, fmtTime } from '../shared/describe';
import type { IssueLink, RecorderSession } from '../shared/types';
import { selectedActions } from './steps-ui';
import { buildCsv } from './export-csv';
import { t } from '../shared/i18n';

const DOCK_KEY = 'bugrec.submitDock';

interface DockPref {
  side: 'left' | 'right';
  isCollapsed: boolean;
}

let updatingIssueId: number | null = null;

function shotLimit(): number {
  const el = $('bugShotMax') as HTMLInputElement | null;
  const n = Number(el && el.value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function initReport(): void {
  $('bugSubject').addEventListener('input', () => (store.subjectDirty = true));
  $('bugDescription').addEventListener('input', () => (store.descDirty = true));
  $('btnRegen').addEventListener('click', () => {
    store.descDirty = false;
    regenerateDescription();
  });
  $('btnCopyDesc').addEventListener('click', onCopy);
  $('btnLoadProjects').addEventListener('click', () => void import('./settings-ui').then((m) => m.loadProjects()));
  $('btnExport').addEventListener('click', onExport);
  $('btnExportCsv').addEventListener('click', onExportCsv);
  $('bugForm').addEventListener('submit', (e) => void onSubmit(e));
  $('btnDockExpand').addEventListener('click', () => setDockCollapsed(false));
  $('btnDockCollapse').addEventListener('click', () => setDockCollapsed(true));
  $('btnDockSide').addEventListener('click', () => flipDockSide());
  $('btnDockSideRail').addEventListener('click', () => flipDockSide());
  applyDock(readDock());
}

export function prefillForm(): void {
  if (!store.cache) return;
  const { session, actions } = store.cache;
  $('submitResult').textContent = '';
  setUpdateTarget(null);
  if (!store.subjectDirty) ($('bugSubject') as HTMLInputElement).value = session.subject || buildSubject(session, actions);
  if (!store.descDirty) regenerateDescription();
  renderIssueLinks(session);
}

export function regenerateDescription(): void {
  if (!store.cache) return;
  const acts = selectedActions();
  const ids = new Set(acts.map((a) => a.id).filter((id): id is number => typeof id === 'number'));
  const { session, actions, requests, logs, pinia } = store.cache;
  const lastArr = acts.length ? acts : actions.slice(-1);
  const lastUrl = lastArr.length ? lastArr[0]!.url : '';
  ($('bugDescription') as HTMLTextAreaElement).value = buildDescription(
    session,
    acts,
    ownedBySelection(actions, ids, requests),
    ownedBySelection(actions, ids, logs),
    { userAgent: navigator.userAgent, lastUrl },
    {
      piniaEvents: ownedBySelection(actions, ids, pinia),
      shotLimit: shotLimit(),
      notes: (store.full && store.full.notes) || store.cache.notes || [],
    }
  );
}

async function onCopy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(($('bugDescription') as HTMLTextAreaElement).value);
    $('btnCopyDesc').textContent = t('btnCopied');
    window.setTimeout(() => ($('btnCopyDesc').textContent = t('btnCopy')), 2000);
  } catch {
    showError(new Error(t('copyFailed')));
  }
}

async function onSubmit(e: Event): Promise<void> {
  e.preventDefault();
  if (!store.cache) return;
  const projectId = ($('bugProjectManual') as HTMLInputElement).value.trim() || ($('bugProject') as HTMLSelectElement).value;
  if (!updatingIssueId && !projectId) {
    showError(new Error(t('needProject')));
    return;
  }
  const btn = $('btnSubmit') as HTMLButtonElement;
  const isUpdate = updatingIssueId != null;
  btn.disabled = true;
  btn.textContent = isUpdate ? t('updating') : t('submitting');
  $('submitResult').textContent = '';
  try {
    const res = await send({
      type: 'SUBMIT_REDMINE',
      sessionId: store.cache.session.id,
      subject: ($('bugSubject') as HTMLInputElement).value.trim(),
      description: ($('bugDescription') as HTMLTextAreaElement).value,
      projectId,
      issueId: updatingIssueId,
      trackerId: ($('bugTracker') as HTMLSelectElement).value,
      priorityId: ($('bugPriority') as HTMLSelectElement).value,
      attachScreenshots: ($('bugAttach') as HTMLInputElement).checked,
      attachCsv: ($('bugAttachCsv') as HTMLInputElement).checked,
      shotLimit: shotLimit(),
      selectedActionIds: [...store.selected],
    });
    if (store.cache) {
      store.cache.session.status = 'submitted';
      store.cache.session.issueId = res.issueId;
      store.cache.session.issueUrl = res.issueUrl;
      store.cache.session.submissions = res.submissions;
      if (store.full && store.full.session.id === store.cache.session.id) store.full.session.submissions = res.submissions;
      renderIssueLinks(store.cache.session);
    }
    const verb = isUpdate ? t('updatedIssue', String(res.issueId)) : t('created');
    $('submitResult').textContent = res.uploadCount ? t('withAttachments', [verb, String(res.uploadCount)]) : verb;
    const { refreshSessions } = await import('./sessions-ui');
    void refreshSessions();
  } catch (err) {
    showError(err);
  } finally {
    btn.disabled = false;
    paintSubmitButton();
  }
}

export function issueLinksOf(session: RecorderSession): IssueLink[] {
  if (session.submissions && session.submissions.length) return session.submissions;
  if (session.issueId && session.issueUrl) {
    return [{
      issueId: session.issueId,
      issueUrl: session.issueUrl,
      subject: session.subject || '',
      submittedAt: session.endedAt || session.startedAt,
    }];
  }
  return [];
}

export function renderIssueLinks(session: RecorderSession): void {
  const box = $('issueHistory');
  box.textContent = '';
  const links = issueLinksOf(session);
  const rail = $('btnDockExpand');
  rail.textContent = links.length ? t('submitBugCount', String(links.length)) : t('submitBug');
  if (!links.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const title = document.createElement('div');
  title.className = 'issue-links-title';
  title.textContent = t('historyTitle', String(links.length));
  const list = document.createElement('ul');
  for (const link of [...links].reverse()) {
    list.appendChild(buildHistoryItem(link));
  }
  box.append(title, list);
}

function buildHistoryItem(link: IssueLink): HTMLLIElement {
  const li = document.createElement('li');
  const anchor = document.createElement('a');
  anchor.href = link.issueUrl;
  anchor.target = '_blank';
  anchor.rel = 'noreferrer';
  const subject = link.subject ? ` ${link.subject.slice(0, 42)}` : '';
  anchor.textContent = `#${link.issueId}${subject}`;
  const time = document.createElement('time');
  const revised = (link.revisionCount || 1) > 1 ? t('revised', String(link.revisionCount)) : '';
  time.textContent = `${fmtTime(link.submittedAt)}${revised}`;
  const update = document.createElement('button');
  update.type = 'button';
  update.textContent = updatingIssueId === link.issueId ? t('updatingThis') : t('updateThis');
  update.addEventListener('click', () => {
    setUpdateTarget(link.issueId);
    setDockCollapsed(false);
  });
  li.append(anchor, time, update);
  return li;
}

function setUpdateTarget(issueId: number | null): void {
  updatingIssueId = issueId;
  const hint = $('updateHint');
  if (!issueId) {
    hint.hidden = true;
    hint.textContent = '';
  } else {
    hint.hidden = false;
    hint.textContent = t('updateHint', String(issueId));
  }
  paintSubmitButton();
  if (store.cache) renderIssueLinks(store.cache.session);
}

function paintSubmitButton(): void {
  const btn = $('btnSubmit') as HTMLButtonElement;
  if (btn.disabled) return;
  btn.textContent = updatingIssueId ? t('updateButton', String(updatingIssueId)) : t('btnSubmit');
}

function readDock(): DockPref {
  try {
    const raw = JSON.parse(localStorage.getItem(DOCK_KEY) || '') as Partial<DockPref>;
    if (raw.side === 'left' || raw.side === 'right') {
      return { side: raw.side, isCollapsed: raw.isCollapsed !== false };
    }
  } catch {
    /* 没有存过偏好时收起在右侧 */
  }
  return { side: 'right', isCollapsed: true };
}

function applyDock(pref: DockPref): void {
  document.body.dataset.dockSide = pref.side;
  document.body.dataset.dockCollapsed = pref.isCollapsed ? '1' : '0';
  localStorage.setItem(DOCK_KEY, JSON.stringify(pref));
}

function setDockCollapsed(isCollapsed: boolean): void {
  const pref = readDock();
  pref.isCollapsed = isCollapsed;
  applyDock(pref);
}

function flipDockSide(): void {
  const pref = readDock();
  pref.side = pref.side === 'left' ? 'right' : 'left';
  applyDock(pref);
}

function onExport(): void {
  if (!store.cache) return;
  const { session, actions, requests, logs, pinia } = store.cache;
  const stripped = actions.map((a) => ({ ...a, screenshot: a.screenshot ? '<dataURL 截图,略>' : null }));
  const blob = new Blob([JSON.stringify({ session, actions: stripped, requests, logs, pinia }, null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bug-recorder-session-${session.id.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function onExportCsv(): void {
  if (!store.cache) return;
  const csv = buildCsv(store.cache);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bug-recorder-session-${store.cache.session.id.slice(0, 8)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
