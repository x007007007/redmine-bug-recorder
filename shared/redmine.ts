// Redmine REST API 客户端(API Key 认证)。
// 文档: https://www.redmine.org/projects/redmine/wiki/Rest_api

import type { RecorderSettings, RedmineUser } from './types';

export class RedmineApiError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string, detail: string) {
    super(`Redmine API ${status} ${path}: ${detail}`);
    this.name = 'RedmineApiError';
    this.status = status;
    this.path = path;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** 站点根地址。用户经常从浏览器地址栏粘贴 /projects/... 或 /issues/...，那些路径下没有 /uploads。 */
const UI_TAIL =
  /\/(?:my\/(?:page|account)|login|activity|search|welcome|projects\/[^/]+(?:\/issues(?:\.json)?(?:\/(?:new|\d+))?)?|projects(?:\.json)?|issues(?:\.json)?(?:\/(?:new|\d+))?)$/i;

export function normalizeBase(url: string | undefined): string {
  let raw = String(url || '').trim().replace(/[#?].*$/, '').replace(/\/+$/, '');
  if (!raw) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw.replace(/^\/+/, '')}`;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }
  let path = parsed.pathname.replace(/\/+$/, '');
  if (path === '/') path = '';
  for (let i = 0; i < 3 && UI_TAIL.test(path); i += 1) {
    path = path.replace(UI_TAIL, '').replace(/\/+$/, '');
  }
  return parsed.origin + path;
}

interface ApiFetchOptions {
  method?: string;
  body?: BodyInit;
  contentType?: string;
}

function withKey(path: string, apiKey: string, isKeyInQuery: boolean): string {
  if (!isKeyInQuery) return path;
  const join = path.includes('?') ? '&' : '?';
  return `${path}${join}key=${encodeURIComponent(apiKey)}`;
}

function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('key');
    return parsed.toString();
  } catch {
    return url.replace(/([?&]key=)[^&]*/g, '$1***');
  }
}

function failureDetail(status: number, path: string, detail: string, finalUrl: string): string {
  const where = finalUrl ? `最终响应 ${safeUrl(finalUrl)}。` : '';
  if (status === 404 && /\/issues\/\d+/.test(path)) {
    return `${detail} ${where}这个 issue 不存在,或当前账号看不到它。`;
  }
  if (status === 404 && path.includes('/issues')) {
    return `${detail} ${where}项目不存在:请填数字 ID 或项目标识(URL 里的英文),不要填项目显示名;Redmine 地址用站点根路径。`;
  }
  if (status === 404) return `${detail} ${where}请确认地址是站点根路径(不要带 /projects 或 /issues),且已启用 REST API。`;
  return `${detail} ${where}`.trim();
}

async function sendApi(
  base: string,
  path: string,
  apiKey: string,
  options: ApiFetchOptions,
  isKeyInQuery: boolean,
  isOmitApiKeyHeader: boolean
): Promise<unknown> {
  const method = options.method || 'GET';
  let res: Response;
  try {
    res = await fetch(base + withKey(path, apiKey, isKeyInQuery), {
      method,
      headers: {
        Accept: 'application/json',
        ...(isOmitApiKeyHeader ? {} : { 'X-Redmine-API-Key': apiKey }),
        ...(options.body ? { 'Content-Type': options.contentType || 'application/json' } : {}),
      },
      body: options.body,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法连接 Redmine(${base}): ${message}`);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const errs = (data as { errors?: string[] } | null)?.errors;
    const detail = errs ? errs.join('; ') : (text || res.statusText || `HTTP ${res.status}`).slice(0, 300);
    throw new RedmineApiError(res.status, `${method} ${path}`, failureDetail(res.status, path, detail, res.url));
  }
  return data;
}

async function apiFetch(settings: Partial<RecorderSettings>, path: string, options: ApiFetchOptions = {}): Promise<unknown> {
  assert(settings.redmineUrl && settings.apiKey, '请先在"设置"中配置 Redmine 地址与 API Key');
  const base = normalizeBase(settings.redmineUrl);
  assert(/^https?:\/\//i.test(base), 'Redmine 地址需要以 http:// 或 https:// 开头');
  const method = (options.method || 'GET').toUpperCase();
  try {
    return await sendApi(base, path, settings.apiKey, options, false, false);
  } catch (error) {
    if (!(error instanceof RedmineApiError)) throw error;
    // 401: 反代丢掉自定义头时,改走官方支持的 ?key=
    if (error.status === 401) return sendApi(base, path, settings.apiKey, options, true, false);
    // GET 404: 有的网关看到 X-Redmine-API-Key 直接 404,去掉该头再用 ?key= 试一次
    if (error.status === 404 && method === 'GET') return sendApi(base, path, settings.apiKey, options, true, true);
    throw error;
  }
}

export function isNotFound(error: unknown): error is RedmineApiError {
  return error instanceof RedmineApiError && error.status === 404;
}

export async function testConnection(settings: Partial<RecorderSettings>): Promise<RedmineUser> {
  const data = (await apiFetch(settings, '/users/current.json')) as { user?: Record<string, string> };
  const u = data?.user || {};
  return { login: u.login || '', name: [u.firstname, u.lastname].filter(Boolean).join(' ') };
}

export interface RedmineProject {
  id: number;
  name: string;
  identifier?: string;
}

/**
 * 项目列表。路径从 Redmine 1.0 到 7.x 都是 GET /projects.json,版本差异不会表现为 404。
 * 分页参数是 1.1 才有的;更早的实例、以及会拦截查询串的网关,退回不带参数的 /projects.json。
 * 若这个地址确实不存在,再用 2.2+ 的当前用户成员关系取出可提交的项目。
 */
export async function listProjects(settings: Partial<RecorderSettings>): Promise<RedmineProject[]> {
  const paged = await readProjects(settings, true);
  if (paged) return paged;
  const plain = await readProjects(settings, false);
  if (plain) return plain;
  const joined = await projectsFromMemberships(settings);
  if (joined.length) return joined;
  const base = normalizeBase(settings.redmineUrl);
  throw new RedmineApiError(
    404,
    'GET /projects.json',
    `不是接口版本不兼容。Redmine 1.0 至今的项目列表都是 GET /projects.json,版本不对不会返回 404。实际请求的是 ${base}/projects.json ,服务器上没有这个地址。请把设置改成浏览器打开 Redmine 首页的根地址,子路径要保留(例如 http://host/redmine),保存后再载入。`
  );
}

async function readProjects(settings: Partial<RecorderSettings>, isPaged: boolean): Promise<RedmineProject[] | null> {
  try {
    if (!isPaged) return mapProjects(await apiFetch(settings, '/projects.json'));
    return await listProjectsByPage(settings);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function listProjectsByPage(settings: Partial<RecorderSettings>): Promise<RedmineProject[]> {
  const out: RedmineProject[] = [];
  let offset = 0;
  const limit = 100;
  for (let i = 0; i < 10; i += 1) {
    const data = (await apiFetch(settings, `/projects.json?limit=${limit}&offset=${offset}`)) as {
      total_count?: number | string;
    };
    const list = mapProjects(data);
    out.push(...list);
    const total = data && data.total_count != null ? Number(data.total_count) : out.length;
    offset += limit;
    if (!list.length || out.length >= total) break;
  }
  return out;
}

function mapProjects(data: unknown): RedmineProject[] {
  const list = (data as { projects?: { id: number; name: string; identifier?: string }[] } | null)?.projects || [];
  return list.map((project) => ({ id: project.id, name: project.name, identifier: project.identifier }));
}

async function projectsFromMemberships(settings: Partial<RecorderSettings>): Promise<RedmineProject[]> {
  try {
    const data = (await apiFetch(settings, '/users/current.json?include=memberships')) as {
      user?: { memberships?: { project?: { id: number; name: string; identifier?: string } }[] };
    };
    const seen = new Set<number>();
    const out: RedmineProject[] = [];
    for (const item of data?.user?.memberships || []) {
      const project = item.project;
      if (!project || seen.has(project.id)) continue;
      seen.add(project.id);
      out.push({ id: project.id, name: project.name, identifier: project.identifier });
    }
    return out;
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

export async function listTrackers(settings: Partial<RecorderSettings>): Promise<{ id: number; name: string }[]> {
  // trackers.json 需要 Redmine 4.0+;旧版本返回空列表,由项目默认 tracker 兜底。
  const data = (await apiFetch(settings, '/trackers.json?limit=100').catch(() => null)) as {
    trackers?: { id: number; name: string }[];
  } | null;
  if (!data) return [];
  return data.trackers || [];
}

export async function listPriorities(settings: Partial<RecorderSettings>): Promise<{ id: number; name: string }[]> {
  const data = (await apiFetch(settings, '/enumerations/issue_priorities.json').catch(() => null)) as {
    issue_priorities?: { id: number; name: string }[];
  } | null;
  if (!data) return [];
  return data.issue_priorities || [];
}

export interface UploadToken {
  token: string;
  id: number;
}

function asBlob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: 'application/octet-stream' });
}

async function postUpload(settings: Partial<RecorderSettings>, path: string, blob: Blob): Promise<UploadToken | null> {
  const data = (await apiFetch(settings, path, {
    method: 'POST',
    body: blob,
    contentType: 'application/octet-stream',
  })) as { upload?: UploadToken };
  return data ? data.upload || null : null;
}

/**
 * 上传附件。先走文档里的 /uploads.json;部分站点只注册了 /uploads,对 .json 直接 404。
 * 用 Blob 带上 Content-Length,避免反代把 chunked POST 回成 404。
 */
export async function uploadAttachment(
  settings: Partial<RecorderSettings>,
  filename: string,
  bytes: Uint8Array
): Promise<UploadToken | null> {
  const blob = asBlob(bytes);
  const query = `filename=${encodeURIComponent(filename)}`;
  const primary = `/uploads.json?${query}`;
  try {
    return await postUpload(settings, primary, blob);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  try {
    return await postUpload(settings, `/uploads?${query}`, blob);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    throw new RedmineApiError(
      404,
      `POST ${primary}`,
      '附件接口 /uploads.json 和 /uploads 都返回 404。请把地址改成站点根路径(例如 https://redmine.example.com),并确认管理 → 配置 → API 里已启用 REST。可以先取消附件勾选,只提交文字。'
    );
  }
}

export async function createIssue(
  settings: Partial<RecorderSettings>,
  payload: { issue: Record<string, unknown> }
): Promise<{ issue?: { id: number } }> {
  return apiFetch(settings, '/issues.json', {
    method: 'POST',
    body: JSON.stringify(payload),
  }) as Promise<{ issue?: { id: number } }>;
}

/** 更新已有 issue。Redmine 成功时通常返回 204,描述变更会记进工单历史。 */
export async function updateIssue(
  settings: Partial<RecorderSettings>,
  issueId: number,
  payload: { issue: Record<string, unknown> }
): Promise<void> {
  await apiFetch(settings, `/issues/${issueId}.json`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
