// Redmine 相关的 background 端点:连接测试/下拉数据 + 提交 issue。
// 截图:有点击坐标的在原截图上烙入半透明点击标记(PNG,透明通道),数量受 shotLimit 限制(取最近 N 张)。

import {
  testConnection,
  listProjects,
  listTrackers,
  listPriorities,
  uploadAttachment,
  createIssue,
  dataUrlToBytes,
} from '../shared/redmine';
import { planShotUploads } from '../shared/shots';
import { dbPut, dbGet } from '../shared/db';
import { getSettings, notifySessionUpdated } from './state';
import { getSession } from './sessions';
import type { IssueLink, RecordedAction, RecorderSession, RecorderSettings, SubmitResult } from '../shared/types';

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
  shotLimit?: number;
  selectedActionIds?: number[];
}): Promise<SubmitResult> {
  const settings = await getSettings();
  const { actions: allActions } = await getSession(msg.sessionId);
  const session = await dbGet<RecorderSession>('sessions', msg.sessionId);
  if (!session) throw new Error('会话不存在');

  const selectedIds = Array.isArray(msg.selectedActionIds) ? msg.selectedActionIds : null;
  const actions = selectedIds ? allActions.filter((a) => selectedIds.includes(a.id!)) : allActions;

  // 截图计划与描述命名共用同一函数,文件名严格一致
  const plan = planShotUploads(actions, msg.shotLimit || 0);
  const uploads: { token: string; filename: string; content_type: string }[] = [];
  for (const item of plan) {
    const a = actions.find((x) => x.id === item.actionId);
    if (!a) continue;
    let bytes: Uint8Array;
    let contentType: string;
    if (item.isPng) {
      const baked = await bakeClickMarker(a.screenshot!, a.point!, a.viewport!).catch(() => null);
      bytes = baked || dataUrlToBytes(a.screenshot!);
      contentType = baked ? 'image/png' : 'image/jpeg';
    } else {
      bytes = dataUrlToBytes(a.screenshot!);
      contentType = 'image/jpeg';
    }
    const upload = await uploadAttachment(settings, item.filename, bytes);
    if (upload && upload.token) {
      uploads.push({ token: upload.token, filename: item.filename, content_type: contentType });
    }
  }

  const issue: Record<string, unknown> = {
    project_id: msg.projectId,
    subject: msg.subject,
    description: msg.description,
  };
  if (msg.trackerId) issue.tracker_id = Number(msg.trackerId);
  if (msg.priorityId) issue.priority_id = Number(msg.priorityId);
  if (uploads.length) issue.uploads = uploads;

  const resp = await createIssue(settings, { issue });
  const issueId = resp && resp.issue ? resp.issue.id : null;

  const issueUrl = issueId ? `${(settings.redmineUrl || '').replace(/\/+$/, '')}/issues/${issueId}` : null;
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

/** 保留历次提交。旧数据只有一条 issueUrl 时,先补进列表再追加本次。 */
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
    });
  }
  if (next.issueId && next.issueUrl && !history.some((item) => item.issueId === next.issueId)) {
    history.push({
      issueId: next.issueId,
      issueUrl: next.issueUrl,
      subject: next.subject || '',
      submittedAt: next.submittedAt,
    });
  }
  return history;
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
