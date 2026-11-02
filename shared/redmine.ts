// Redmine REST API 客户端(API Key 认证)。
// 文档: https://www.redmine.org/projects/redmine/wiki/Rest_api

import type { RecorderSettings, RedmineUser } from './types';

export function normalizeBase(url: string | undefined): string {
  return String(url || '').trim().replace(/\/+$/, '');
}

interface ApiFetchOptions {
  method?: string;
  body?: BodyInit;
  contentType?: string;
}

async function apiFetch(settings: Partial<RecorderSettings>, path: string, options: ApiFetchOptions = {}): Promise<unknown> {
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
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const errs = (data as { errors?: string[] } | null)?.errors;
    const detail = errs ? errs.join('; ') : (text || res.statusText || `HTTP ${res.status}`).slice(0, 300);
    throw new Error(`Redmine API ${res.status}: ${detail}`);
  }
  return data;
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

/** 分页拉取(Redmine 默认每页 25);仅返回该账号可见的项目 */
export async function listProjects(settings: Partial<RecorderSettings>): Promise<RedmineProject[]> {
  const out: RedmineProject[] = [];
  let offset = 0;
  const limit = 100;
  for (let i = 0; i < 10; i++) {
    const data = (await apiFetch(settings, `/projects.json?limit=${limit}&offset=${offset}&status=*`)) as {
      projects?: { id: number; name: string; identifier?: string }[];
      total_count?: number | string;
    };
    const list = data?.projects || [];
    out.push(...list.map((p) => ({ id: p.id, name: p.name, identifier: p.identifier })));
    const total = data && data.total_count != null ? Number(data.total_count) : out.length;
    offset += limit;
    if (!list.length || out.length >= total) break;
  }
  return out;
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

/** 上传附件:先 POST /uploads.json 拿 token,再在创建 issue 时引用。 */
export async function uploadAttachment(
  settings: Partial<RecorderSettings>,
  filename: string,
  bytes: Uint8Array
): Promise<UploadToken | null> {
  const data = (await apiFetch(settings, `/uploads.json?filename=${encodeURIComponent(filename)}`, {
    method: 'POST',
    body: bytes as unknown as BodyInit,
    contentType: 'application/octet-stream',
  })) as { upload?: UploadToken };
  return data ? data.upload || null : null;
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

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
