// Redmine REST API 客户端(API Key 认证)。
// 文档: https://www.redmine.org/projects/redmine/wiki/Rest_api

export function normalizeBase(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

async function apiFetch(settings, path, options = {}) {
  if (!settings.redmineUrl || !settings.apiKey) {
    throw new Error('请先在"设置"中配置 Redmine 地址与 API Key');
  }
  const res = await fetch(normalizeBase(settings.redmineUrl) + path, {
    method: options.method || 'GET',
    headers: {
      'X-Redmine-API-Key': settings.apiKey,
      ...(options.body ? { 'Content-Type': options.contentType || 'application/json' } : {}),
    },
    body: options.body,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const detail =
      data && data.errors
        ? data.errors.join('; ')
        : (text || res.statusText || `HTTP ${res.status}`).slice(0, 300);
    throw new Error(`Redmine API ${res.status}: ${detail}`);
  }
  return data;
}

export async function testConnection(settings) {
  const data = await apiFetch(settings, '/users/current.json');
  const u = (data && data.user) || {};
  return { login: u.login, name: [u.firstname, u.lastname].filter(Boolean).join(' ') };
}

export async function listProjects(settings) {
  // 分页拉取(Redmine 默认每页 25);仅返回该账号可见的项目
  const out = [];
  let offset = 0;
  const limit = 100;
  for (let i = 0; i < 10; i++) {
    const data = await apiFetch(settings, `/projects.json?limit=${limit}&offset=${offset}&status=*`);
    const list = (data && data.projects) || [];
    out.push(...list.map((p) => ({ id: p.id, name: p.name, identifier: p.identifier })));
    const total = data && data.total_count != null ? Number(data.total_count) : out.length;
    offset += limit;
    if (!list.length || out.length >= total) break;
  }
  return out;
}

export async function listTrackers(settings) {
  // trackers.json 需要 Redmine 4.0+;旧版本返回空列表,由项目默认 tracker 兜底。
  const data = await apiFetch(settings, '/trackers.json?limit=100').catch(() => null);
  if (!data) return [];
  return (data.trackers || []).map((t) => ({ id: t.id, name: t.name }));
}

export async function listPriorities(settings) {
  const data = await apiFetch(settings, '/enumerations/issue_priorities.json').catch(() => null);
  if (!data) return [];
  return (data.issue_priorities || []).map((p) => ({ id: p.id, name: p.name }));
}

// 上传附件:先 POST /uploads.json 拿 token,再在创建 issue 时引用。
export async function uploadAttachment(settings, filename, bytes) {
  const data = await apiFetch(
    settings,
    `/uploads.json?filename=${encodeURIComponent(filename)}`,
    { method: 'POST', body: bytes, contentType: 'application/octet-stream' }
  );
  return data && data.upload ? data.upload : null;
}

export async function createIssue(settings, payload) {
  return apiFetch(settings, '/issues.json', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
