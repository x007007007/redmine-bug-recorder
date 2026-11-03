// Redmine 相关的 background 端点:连接测试/下拉数据 + 提交 issue。
// 截图:有点击坐标的在原截图上烙入半透明点击标记(PNG,透明通道),数量受 shotLimit 限制(取最近 N 张)。

import { buildCsv } from '../manager/export-csv';
import {
  testConnection,
  listProjects,
  listTrackers,
  listPriorities,
  uploadAttachment,
  createIssue,
  updateIssue,
  dataUrlToBytes,
  normalizeBase,
} from '../shared/redmine';
import { planShotUploads } from '../shared/shots';
import { ownedBySelection } from '../shared/timeline';
import { dbPut } from '../shared/db';
import { getSettings, notifySessionUpdated } from './state';
import { getSession } from './sessions';
import type { IssueLink, RecordedAction, RecorderSession, RecorderSettings, SessionDetail, SubmitResult } from '../shared/types';

export const redmineEndpoints: Record<
  string,
  (msg: Record<string, unknown>) => Promise<unknown>
> = {
  TEST_REDMINE: (msg) => testConnection((msg.settings as Partial<RecorderSettings>) || {}),
  LIST_PROJECTS: () => getSettings().then(listProjects),
  LIST_TRACKERS: () => getSettings().then(listTrackers),
  LIST_PRIORITIES: () => getSettings().then(listPriorities),
};

export async function submitRedmine(msg: {
  sessionId: string;
  subject: string;
  description: string;
  projectId: string | number;
  trackerId?: string | number;
  priorityId?: string | number;
  attachScreenshots?: boolean;
  attachCsv?: boolean;
  shotLimit?: number;
  selectedActionIds?: number[];
  issueId?: number | null;
}): Promise<SubmitResult> {
  const settings = await getSettings();
  const detail = await getSession(msg.sessionId);
  const session = detail.session;

  const selectedIds = Array.isArray(msg.selectedActionIds) ? msg.selectedActionIds : null;
  const actions = selectedIds ? detail.actions.filter((a) => selectedIds.includes(a.id!)) : detail.actions;
  const uploads: { token: string; filename: string; content_type: string }[] = [];
  if (msg.attachScreenshots !== false) {
    uploads.push(...(await uploadShots(settings, actions, msg.shotLimit || 0)));
  }
  if (msg.attachCsv) {
    const csv = await uploadCsv(settings, detail, selectedIds);
    if (csv) uploads.push(csv);
  }

  const issue: Record<string, unknown> = {
    subject: msg.subject,
    description: msg.description,
  };
  if (msg.projectId) issue.project_id = msg.projectId;
  if (msg.trackerId) issue.tracker_id = Number(msg.trackerId);
  if (msg.priorityId) issue.priority_id = Number(msg.priorityId);
  if (uploads.length) issue.uploads = uploads;

  const saved = await saveIssue(settings, msg.issueId, issue);
  const issueId = saved.issueId;
  const issueUrl = saved.issueUrl;
  const submissions = appendSubmission(session, {
    issueId,
    issueUrl,
    subject: msg.subject,
    submittedAt: Date.now(),
  });
  session.status = 'submitted';
  session.issueId = issueId;
  session.issueUrl = issueUrl;
  session.submissions = submissions;
  await dbPut('sessions', session);
  notifySessionUpdated();

  return { issueId, issueUrl, uploadCount: uploads.length, submissions };
}

async function saveIssue(
  settings: RecorderSettings,
  existingId: number | null | undefined,
  issue: Record<string, unknown>
): Promise<{ issueId: number | null; issueUrl: string | null }> {
  const base = normalizeBase(settings.redmineUrl);
  const issueId = existingId ? Number(existingId) : null;
  if (issueId) {
    await updateIssue(settings, issueId, { issue });
    return { issueId, issueUrl: `${base}/issues/${issueId}` };
  }
  const resp = await createIssue(settings, { issue });
  const createdId = resp && resp.issue ? resp.issue.id : null;
  return { issueId: createdId, issueUrl: createdId ? `${base}/issues/${createdId}` : null };
}

/** 保留历次提交。同一条 issue 再次更新时改时间和次数,不另开一条。 */
function appendSubmission(
  session: RecorderSession,
  next: { issueId: number | null; issueUrl: string | null; subject: string; submittedAt: number }
): IssueLink[] {
  const history = Array.isArray(session.submissions) ? session.submissions.slice() : [];
  if (!history.length && session.issueId && session.issueUrl) {
    history.push({
      issueId: session.issueId,
      issueUrl: session.issueUrl,
      subject: session.subject || '',
      submittedAt: session.endedAt || session.startedAt,
      revisionCount: 1,
    });
  }
  if (!next.issueId || !next.issueUrl) return history;
  const existing = history.find((item) => item.issueId === next.issueId);
  if (existing) {
    existing.subject = next.subject || existing.subject;
    existing.issueUrl = next.issueUrl;
    existing.submittedAt = next.submittedAt;
    existing.revisionCount = (existing.revisionCount || 1) + 1;
    return history;
  }
  history.push({
    issueId: next.issueId,
    issueUrl: next.issueUrl,
    subject: next.subject || '',
    submittedAt: next.submittedAt,
    revisionCount: 1,
  });
  return history;
}

async function uploadShots(
  settings: RecorderSettings,
  actions: RecordedAction[],
  shotLimit: number
): Promise<{ token: string; filename: string; content_type: string }[]> {
  const plan = planShotUploads(actions, shotLimit);
  const uploads: { token: string; filename: string; content_type: string }[] = [];
  for (const item of plan) {
    const uploaded = await uploadOneShot(settings, actions, item);
    if (uploaded) uploads.push(uploaded);
  }
  return uploads;
}

async function uploadOneShot(
  settings: RecorderSettings,
  actions: RecordedAction[],
  item: { actionId: number | undefined; filename: string; isPng: boolean }
): Promise<{ token: string; filename: string; content_type: string } | null> {
  const action = actions.find((x) => x.id === item.actionId);
  if (!action?.screenshot) return null;
  const baked = item.isPng ? await bakeClickMarker(action.screenshot, action.point!, action.viewport!).catch(() => null) : null;
  const bytes = baked || dataUrlToBytes(action.screenshot);
  const contentType = baked ? 'image/png' : 'image/jpeg';
  const upload = await uploadAttachment(settings, item.filename, bytes);
  if (!upload?.token) return null;
  return { token: upload.token, filename: item.filename, content_type: contentType };
}

async function uploadCsv(
  settings: RecorderSettings,
  detail: SessionDetail,
  selectedIds: number[] | null
): Promise<{ token: string; filename: string; content_type: string } | null> {
  const filename = `bug-recorder-session-${detail.session.id.slice(0, 8)}.csv`;
  const upload = await uploadAttachment(settings, filename, csvBytes(detail, selectedIds));
  if (!upload?.token) return null;
  return { token: upload.token, filename, content_type: 'text/csv' };
}

function csvBytes(detail: SessionDetail, selectedIds: number[] | null): Uint8Array {
  const ids = selectedIds ? new Set(selectedIds) : null;
  const scoped = ids ? scopeDetail(detail, ids) : detail;
  return new TextEncoder().encode(`\uFEFF${buildCsv(scoped)}`);
}

function scopeDetail(detail: SessionDetail, ids: Set<number>): SessionDetail {
  return {
    ...detail,
    actions: detail.actions.filter((action) => typeof action.id === 'number' && ids.has(action.id)),
    requests: ownedBySelection(detail.actions, ids, detail.requests),
    logs: ownedBySelection(detail.actions, ids, detail.logs),
    pinia: ownedBySelection(detail.actions, ids, detail.pinia),
    notes: ownedBySelection(detail.actions, ids, detail.notes),
  };
}

/** 在截图上烙入半透明点击标记:外圈描边 + 内圈半透明填充 */
async function bakeClickMarker(
  dataUrl: string,
  point: { x: number; y: number },
  viewport: { w: number; h: number }
): Promise<Uint8Array> {
  if (typeof OffscreenCanvas === 'undefined') return null as unknown as Uint8Array;
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const x = (point.x / viewport.w) * bmp.width;
  const y = (point.y / viewport.h) * bmp.height;
  const r = Math.max(7, bmp.width * 0.012);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(2.5, r * 0.28);
  ctx.strokeStyle = 'rgba(217,48,37,0.95)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(217,48,37,0.45)';
  ctx.fill();
  const out = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await out.arrayBuffer());
}

export type { RecordedAction };
