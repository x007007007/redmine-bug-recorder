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
} from '../shared/redmine.js';
import { planShotUploads } from '../shared/shots.js';
import { dbPut } from '../shared/db.js';
import { getSettings, notifySessionUpdated } from './state.js';
import { getSession } from './sessions.js';

export const redmineEndpoints = {
  TEST_REDMINE: (msg) => testConnection(msg.settings || {}),
  LIST_PROJECTS: () => getSettings().then(listProjects),
  LIST_TRACKERS: () => getSettings().then(listTrackers),
  LIST_PRIORITIES: () => getSettings().then(listPriorities),
};

export async function submitRedmine(msg) {
  const settings = await getSettings();
  const { session, actions: allActions } = await getSession(msg.sessionId);

  const selectedIds = Array.isArray(msg.selectedActionIds) ? msg.selectedActionIds : null;
  const actions = selectedIds ? allActions.filter((a) => selectedIds.includes(a.id)) : allActions;

  // 截图计划与描述命名共用同一函数,文件名严格一致
  const plan = planShotUploads(actions, msg.shotLimit || 0);
  const uploads = [];
  for (const item of plan) {
    const a = actions.find((x) => x.id === item.actionId);
    let bytes;
    let contentType;
    if (item.isPng) {
      const baked = await bakeClickMarker(a.screenshot, a.point, a.viewport).catch(() => null);
      bytes = baked || dataUrlToBytes(a.screenshot);
      contentType = baked ? 'image/png' : 'image/jpeg';
    } else {
      bytes = dataUrlToBytes(a.screenshot);
      contentType = 'image/jpeg';
    }
    const upload = await uploadAttachment(settings, item.filename, bytes);
    if (upload && upload.token) {
      uploads.push({ token: upload.token, filename: item.filename, content_type: contentType });
    }
  }

  const issue = { project_id: msg.projectId, subject: msg.subject, description: msg.description };
  if (msg.trackerId) issue.tracker_id = Number(msg.trackerId);
  if (msg.priorityId) issue.priority_id = Number(msg.priorityId);
  if (uploads.length) issue.uploads = uploads;

  const resp = await createIssue(settings, { issue });
  const issueId = resp && resp.issue ? resp.issue.id : null;

  session.status = 'submitted';
  session.issueId = issueId;
  session.issueUrl = issueId ? `${settings.redmineUrl.replace(/\/+$/, '')}/issues/${issueId}` : null;
  await dbPut('sessions', session);
  notifySessionUpdated();

  return { issueId, issueUrl: session.issueUrl, uploadCount: uploads.length };
}

// 在截图上烙入半透明点击标记:外圈描边 + 内圈半透明填充
async function bakeClickMarker(dataUrl, point, viewport) {
  if (!point || !viewport || typeof OffscreenCanvas === 'undefined') return null;
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d');
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
