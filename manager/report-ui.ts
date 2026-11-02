// Bug 表单:描述生成(仅勾选步骤)/ 重新生成 / 复制 / 提交 Redmine / 导出 JSON 与 CSV。

import { send } from './api';
import { $, showError } from './dom';
import { store } from './store';
import { buildDescription } from '../shared/report';
import { buildSubject } from '../shared/describe';
import { selectedActions } from './steps-ui';
import { buildCsv } from './export-csv';

function shotLimit(): number {
  const el = $('bugShotMax') as HTMLInputElement | null;
  const n = Number(el && el.value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function initReport(): void {
  $('bugSubject').addEventListener('input', () => (store.subjectDirty = true));
  $('bugDescription').addEventListener('input', () => (store.descDirty = true));
  $('btnRegen').addEventListener('click', () => {
    regenerateDescription();
    store.descDirty = false;
  });
  $('btnCopyDesc').addEventListener('click', onCopy);
  $('btnLoadProjects').addEventListener('click', () => void import('./settings-ui').then((m) => m.loadProjects()));
  $('btnExport').addEventListener('click', onExport);
  $('btnExportCsv').addEventListener('click', onExportCsv);
  $('bugForm').addEventListener('submit', (e) => void onSubmit(e));
}

export function prefillForm(): void {
  if (!store.cache) return;
  const { session, actions } = store.cache;
  $('submitResult').textContent = '';
  if (!store.subjectDirty) ($('bugSubject') as HTMLInputElement).value = session.subject || buildSubject(session, actions);
  if (!store.descDirty) regenerateDescription();
  if (session.issueUrl && !$('submitResult').textContent.trim()) {
    $('submitResult').innerHTML = `已提交:<a href="${session.issueUrl}" target="_blank">${session.issueUrl}</a>`;
  }
}

export function regenerateDescription(): void {
  if (!store.cache) return;
  const acts = selectedActions();
  const { session, requests, logs, pinia } = store.cache;
  const lastArr = acts.length ? acts : store.cache.actions.slice(-1);
  const lastUrl = lastArr.length ? lastArr[0]!.url : '';
  ($('bugDescription') as HTMLTextAreaElement).value = buildDescription(
    session,
    acts,
    requests,
    logs,
    { userAgent: navigator.userAgent, lastUrl },
    { piniaEvents: pinia, shotLimit: shotLimit() }
  );
}

async function onCopy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(($('bugDescription') as HTMLTextAreaElement).value);
    $('btnCopyDesc').textContent = '已复制 ✓';
    window.setTimeout(() => ($('btnCopyDesc').textContent = '复制描述'), 2000);
  } catch {
    showError(new Error('复制失败,请手动全选复制'));
  }
}

async function onSubmit(e: Event): Promise<void> {
  e.preventDefault();
  if (!store.cache) return;
  const projectId = ($('bugProjectManual') as HTMLInputElement).value.trim() || ($('bugProject') as HTMLSelectElement).value;
  if (!projectId) {
    showError(new Error('请先载入并选择项目,或在"手动填项目标识"中填写(Redmine 项目页 URL 中的标识或数字 ID)'));
    return;
  }
  const btn = $('btnSubmit') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = '提交中…';
  $('submitResult').textContent = '';
  try {
    const res = await send({
      type: 'SUBMIT_REDMINE',
      sessionId: store.cache.session.id,
      subject: ($('bugSubject') as HTMLInputElement).value.trim(),
      description: ($('bugDescription') as HTMLTextAreaElement).value,
      projectId,
      trackerId: ($('bugTracker') as HTMLSelectElement).value,
      priorityId: ($('bugPriority') as HTMLSelectElement).value,
      attachScreenshots: ($('bugAttach') as HTMLInputElement).checked,
      shotLimit: shotLimit(),
      selectedActionIds: [...store.selected],
    });
    $('submitResult').innerHTML =
      `✅ 已创建 issue <b>#${res.issueId}</b>(含 ${res.uploadCount} 张截图):` +
      `<a href="${res.issueUrl}" target="_blank">${res.issueUrl}</a>`;
    const { refreshSessions } = await import('./sessions-ui');
    void refreshSessions();
  } catch (err) {
    showError(err);
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 提交到 Redmine';
  }
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
