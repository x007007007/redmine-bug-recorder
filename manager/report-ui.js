// Bug 表单:描述生成(仅勾选步骤)/ 重新生成 / 复制 / 提交 Redmine / 导出 JSON。

import { send } from './api.js';
import { $, showError } from './dom.js';
import { store } from './store.js';
import { buildDescription, buildSubject } from '../shared/report.js';
import { selectedActions } from './steps-ui.js';
import { buildCsv } from './export-csv.js';

export function init() {
  $('bugSubject').addEventListener('input', () => (store.subjectDirty = true));
  $('bugDescription').addEventListener('input', () => (store.descDirty = true));
  $('btnRegen').addEventListener('click', () => {
    regenerateDescription();
    store.descDirty = false;
  });
  $('btnCopyDesc').addEventListener('click', onCopy);
  $('btnLoadProjects').addEventListener('click', async () => {
    const { loadProjects } = await import('./settings-ui.js');
    loadProjects();
  });
  $('btnExport').addEventListener('click', onExport);
  $('btnExportCsv').addEventListener('click', onExportCsv);
  $('bugForm').addEventListener('submit', onSubmit);
}

function shotLimit() {
  const n = Number($('bugShotMax') && $('bugShotMax').value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function prefillForm() {
  const { session, actions } = store.cache;
  $('submitResult').textContent = '';
  if (!store.subjectDirty) $('bugSubject').value = session.subject || buildSubject(session, actions);
  if (!store.descDirty) regenerateDescription();
  if (session.issueUrl && !$('submitResult').textContent.trim()) {
    $('submitResult').innerHTML = `已提交:<a href="${session.issueUrl}" target="_blank">${session.issueUrl}</a>`;
  }
}

export function regenerateDescription() {
  if (!store.cache) return;
  const acts = selectedActions();
  const { session, requests, logs, pinia } = store.cache;
  const lastUrl = (acts.length ? acts : store.cache.actions.map((a) => a).slice(-1))[0]?.url || '';
  $('bugDescription').value = buildDescription(
    session,
    acts,
    requests,
    logs,
    { userAgent: navigator.userAgent, lastUrl },
    { piniaEvents: pinia, shotLimit: shotLimit() }
  );
}

async function onCopy() {
  try {
    await navigator.clipboard.writeText($('bugDescription').value);
    $('btnCopyDesc').textContent = '已复制 ✓';
    setTimeout(() => ($('btnCopyDesc').textContent = '复制描述'), 2000);
  } catch {
    showError(new Error('复制失败,请手动全选复制'));
  }
}

async function onSubmit(e) {
  e.preventDefault();
  if (!store.cache) return;
  const btn = $('btnSubmit');
  btn.disabled = true;
  btn.textContent = '提交中…';
  $('submitResult').textContent = '';
  try {
    const res = await send({
      type: 'SUBMIT_REDMINE',
      sessionId: store.cache.session.id,
      subject: $('bugSubject').value.trim(),
      description: $('bugDescription').value,
      projectId: $('bugProject').value,
      trackerId: $('bugTracker').value,
      priorityId: $('bugPriority').value,
      attachScreenshots: $('bugAttach').checked,
      selectedActionIds: [...store.selected],
      shotLimit: shotLimit(),
    });
    $('submitResult').innerHTML =
      `✅ 已创建 issue <b>#${res.issueId}</b>(含 ${res.uploadCount} 张截图):` +
      `<a href="${res.issueUrl}" target="_blank">${res.issueUrl}</a>`;
    const { refreshSessions } = await import('./sessions-ui.js');
    refreshSessions();
  } catch (err) {
    showError(err);
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 提交到 Redmine';
  }
}

function onExport() {
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

function onExportCsv() {
  if (!store.cache) return;
  const csv = buildCsv(store.cache);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bug-recorder-session-${store.cache.session.id.slice(0, 8)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
