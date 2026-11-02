// Redmine 相关的 background 端点:连接测试/下拉数据 + 提交 issue(仅勾选步骤的截图)。

import {
  testConnection,
  listProjects,
  listTrackers,
  listPriorities,
  uploadAttachment,
  createIssue,
  dataUrlToBytes,
} from '../shared/redmine.js';
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

  const uploads = [];
  let shotNo = 0;
  if (msg.attachScreenshots) {
    for (const a of actions.filter((x) => x.screenshot)) {
      shotNo += 1;
      const filename = `step-${String(shotNo).padStart(2, '0')}.jpg`;
      const upload = await uploadAttachment(settings, filename, dataUrlToBytes(a.screenshot));
      if (upload && upload.token) {
        uploads.push({ token: upload.token, filename, content_type: 'image/jpeg' });
      }
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
