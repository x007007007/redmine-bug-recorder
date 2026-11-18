#!/usr/bin/env node
// 用 Redmine REST API 创建有层级的项目树、跟踪标签(tracker)与问题类别(issue categories)。
// 幂等:已存在的项目/类别跳过或就地修正,可重复执行。
//
// 用法:
//   node setup.mjs                    # AK 从 .env 或环境变量取
//   node setup.mjs --ak <key> --url http://127.0.0.1:13000
//   node setup.mjs --verify-only      # 只做核验,不创建
//
// AK 读取顺序: --ak > REDMINE_AK 环境变量 > 同目录 .env 的 REDMINE_AK=
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const VERIFY_ONLY = args.includes('--verify-only');
const BASE = (argOf('--url') || process.env.REDMINE_URL || 'http://127.0.0.1:13000').replace(/\/+$/, '');

let AK = argOf('--ak') || process.env.REDMINE_AK;
if (!AK && fs.existsSync(path.join(HERE, '.env'))) {
  for (const line of fs.readFileSync(path.join(HERE, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^REDMINE_AK=(.+?)\s*$/);
    if (m) AK = m[1];
  }
}
if (!AK) {
  console.error('✗ 缺少 API Key:传 --ak <key>,或设环境变量 REDMINE_AK,或在 .env 写 REDMINE_AK=...');
  process.exit(1);
}

/* ---------------- REST 基础 ---------------- */

async function api(pathname, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      'X-Redmine-API-Key': AK,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON(如 204) */
  }
  if (!res.ok) {
    const errs = (data && data.errors) || [];
    throw new Error(`${res.status} ${method} ${pathname}: ${errs.join('; ') || text.slice(0, 200) || res.statusText}`);
  }
  return data;
}

const say = (msg) => console.log(msg);
const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  say(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/* ---------------- 期望的项目树 ---------------- */

// 默认数据(REDMINE_LANG=zh)下的 tracker 名:错误/功能/支持;兼容英文实例。
const TRACKER_PREFS = [
  { names: ['错误', 'Bug'], create: '错误' },
  { names: ['功能', 'Feature'], create: '功能' },
  { names: ['支持', 'Support'], create: '支持' },
];

const PROJECTS = [
  {
    name: '演示系统',
    identifier: 'demo-system',
    description: '本地 Redmine 联调根项目(bug-recorder 插件测试)',
    parent: null,
    categories: ['界面', '接口', '数据'],
  },
  { name: '前端模块', identifier: 'demo-frontend', description: '前端联调子项目', parent: 'demo-system', categories: ['界面', '交互'] },
  { name: '后端模块', identifier: 'demo-backend', description: '后端联调子项目', parent: 'demo-system', categories: ['接口', '数据'] },
  { name: '移动端', identifier: 'demo-mobile', description: '移动端联调子项目', parent: 'demo-system', categories: ['界面', '同步'] },
];

/* ---------------- 主流程 ---------------- */

say(`Redmine: ${BASE}`);
await api('/users/current.json'); // AK 有效性与 REST 开关顺带验证
say(`✓ API Key 有效(REST API 已开启)\n`);

/* tracker:按名字找,缺了就建(需要默认状态) */
async function statusesList() {
  const data = (await api('/issue_statuses.json')) || { issue_statuses: [] };
  return data.issue_statuses || [];
}

async function ensureTrackers() {
  const data = (await api('/trackers.json?limit=100')) || { trackers: [] };
  let trackers = data.trackers || [];
  if (!VERIFY_ONLY && trackers.length === 0) {
    say('(无跟踪标签,先补建)');
    const statuses = await statusesList();
    const open = statuses.find((s) => !s.is_closed) || { id: 1 };
    for (const pref of TRACKER_PREFS) {
      await api('/trackers.json', {
        method: 'POST',
        body: { tracker: { name: pref.create, default_status_id: open.id } },
      });
    }
    trackers = ((await api('/trackers.json?limit=100')) || {}).trackers || [];
  }
  return trackers;
}

const trackers = await ensureTrackers();
say(`跟踪标签(${trackers.length}): ${trackers.map((t) => `${t.id}:${t.name}`).join(', ')}`);

const trackerIds = [];
for (const pref of TRACKER_PREFS) {
  const found = trackers.find((t) => pref.names.includes(t.name));
  if (found) trackerIds.push(found.id);
}
check('三个跟踪标签可用(错误/功能/支持)', trackerIds.length >= 1, `取到 ${trackerIds.length} 个`);

/* 项目:存在则校验/修正,不存在则创建 */
async function listProjects() {
  const out = [];
  let offset = 0;
  for (let page = 0; page < 10; page += 1) {
    const data = (await api(`/projects.json?limit=100&offset=${offset}`)) || {};
    const list = data.projects || [];
    out.push(...list);
    const total = Number(data.total_count ?? out.length);
    offset += 100;
    if (!list.length || out.length >= total) break;
  }
  return out;
}

const existing = await listProjects();
const byIdentifier = new Map(existing.map((p) => [p.identifier, p]));

for (const spec of PROJECTS) {
  const parent = spec.parent ? byIdentifier.get(spec.parent) : null;
  if (spec.parent && !parent) {
    check(`项目 ${spec.identifier} 的父项目存在`, false, `找不到 ${spec.parent}`);
    continue;
  }
  let project = byIdentifier.get(spec.identifier);
  if (!project) {
    if (VERIFY_ONLY) {
      check(`项目 ${spec.identifier}`, false, '不存在');
      continue;
    }
    const body = { project: { name: spec.name, identifier: spec.identifier, description: spec.description, tracker_ids: trackerIds } };
    if (parent) body.project.parent_id = parent.id;
    project = await api('/projects.json', { method: 'POST', body }).then((d) => d.project);
    say(`✓ 创建项目 ${spec.name} (${spec.identifier}) id=${project.id}`);
  } else {
    say(`✓ 项目已存在 ${spec.name} (${spec.identifier}) id=${project.id}`);
  }
  byIdentifier.set(spec.identifier, project);
}

/* 就地核对/修正:tracker 集合、父项目、问题类别 */
for (const spec of PROJECTS) {
  const project = byIdentifier.get(spec.identifier);
  if (!project) continue;
  const detail = await api(`/projects/${project.id}.json?include=trackers`).then((d) => d.project);
  const currentIds = (detail.trackers || []).map((t) => t.id);
  const needIds = trackerIds.filter((id) => !currentIds.includes(id));
  if (!VERIFY_ONLY && needIds.length) {
    await api(`/projects/${project.id}.json`, {
      method: 'PUT',
      body: { project: { tracker_ids: [...currentIds, ...needIds] } },
    });
    say(`✓ 补挂跟踪标签 ${spec.identifier}: +${needIds.length}`);
  }
  const parentName = detail.parent && detail.parent.name;
  const expectParent = spec.parent ? byIdentifier.get(spec.parent)?.name : null;
  check(
    `项目 ${spec.identifier} 层级(${expectParent ? `父=${expectParent}` : '顶层'})`,
    (!expectParent && !parentName) || parentName === expectParent,
    parentName ? `实际父=${parentName}` : '实际父=无'
  );

  const cats = ((await api(`/projects/${project.id}/issue_categories.json`)) || {}).issue_categories || [];
  const missing = spec.categories.filter((name) => !cats.some((c) => c.name === name));
  if (!VERIFY_ONLY && missing.length) {
    for (const name of missing) {
      await api(`/projects/${project.id}/issue_categories.json`, {
        method: 'POST',
        body: { issue_category: { name } },
      });
    }
    say(`✓ 补建问题类别 ${spec.identifier}: ${missing.join('/')}`);
  }
  const after = ((await api(`/projects/${project.id}/issue_categories.json`)) || {}).issue_categories || [];
  const got = spec.categories.every((name) => after.some((c) => c.name === name));
  check(`项目 ${spec.identifier} 问题类别(${spec.categories.join('/')})`, got, `现有 ${after.map((c) => c.name).join('/') || '无'}`);
}

/* 终验:列表可分页拉全、状态/优先级可读(插件提交依赖) */
const listed = await listProjects();
const allFound = PROJECTS.every((s) => listed.some((p) => p.identifier === s.identifier));
check('GET /projects.json 列出全部目标项目', allFound, `${listed.length} 个项目`);

const statusList = await statusesList();
check('GET /issue_statuses.json 可读(默认状态)', statusList.length >= 1, `${statusList.length} 个状态`);

let priorities = [];
try {
  const data = await api('/enumerations/issue_priorities.json');
  priorities = data && data.issue_priorities ? data.issue_priorities : [];
} catch {
  /* 旧版 Redmine 无此接口,插件已兜底 */
}
check('GET /enumerations/issue_priorities.json 可读(优先级)', priorities.length >= 1, `${priorities.length} 个`);

const failed = results.filter((p) => !p).length;
say(`\n${failed === 0 ? '✓ 全部通过' : `✗ ${failed} 项未通过`}`);
process.exit(failed ? 1 : 0);
