// 把本流水线 release/ 里的三个包上传到 GitLab Package Registry,并创建 GitLab Release。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const tag = process.env.CI_COMMIT_TAG ?? '';
const api = (process.env.CI_API_V4_URL ?? '').replace(/\/$/, '');
const projectId = process.env.CI_PROJECT_ID ?? '';
const projectPath = process.env.CI_PROJECT_PATH ?? '';
const server = (process.env.CI_SERVER_URL ?? '').replace(/\/$/, '');
const jobToken = process.env.CI_JOB_TOKEN ?? '';

assert.match(tag, /^v\d+\.\d+\.\d+$/, `tag 必须是 vX.Y.Z,当前是 ${tag}`);
assert.ok(api && projectId && projectPath && server && jobToken, '缺少 GitLab CI 变量');

const ver = tag.slice(1);
const fileNames = [
  `bug-recorder-chrome-v${ver}.zip`,
  `bug-recorder-firefox-v${ver}.xpi`,
  `bug-recorder-source-v${ver}.zip`,
];

/**
 * @param {string} method
 * @param {string} apiPath
 * @param {Buffer | string | undefined} body
 * @param {string | undefined} contentType
 */
async function gitlab(method, apiPath, body, contentType) {
  const headers = { 'JOB-TOKEN': jobToken };
  if (contentType) headers['Content-Type'] = contentType;
  const res = await fetch(`${api}${apiPath}`, { method, headers, body });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, text: buf.toString('utf8') };
}

const existing = await gitlab('GET', `/projects/${projectId}/releases/${encodeURIComponent(tag)}`);
if (existing.status === 200) {
  console.log(`GitLab Release ${tag} 已存在,跳过`);
  process.exit(0);
}

/** @type {{ name: string, url: string, link_type: string }[]} */
const links = [];
for (const name of fileNames) {
  const blob = await readFile(path.join('release', name));
  console.log(`上传 ${name}`);
  const uploaded = await gitlab(
    'PUT',
    `/projects/${projectId}/packages/generic/redmine-bug-recorder/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`,
    blob,
    'application/octet-stream',
  );
  assert.ok(uploaded.status === 200 || uploaded.status === 201, `上传 ${name} 失败 HTTP ${uploaded.status}: ${uploaded.text.slice(0, 300)}`);
  let fileId = 0;
  try {
    fileId = Number(JSON.parse(uploaded.text).id) || 0;
  } catch {
    fileId = 0;
  }
  if (!fileId) fileId = await lookupFileId(name);
  links.push({
    name,
    url: `${server}/${projectPath}/-/package_files/${fileId}/download`,
    link_type: 'package',
  });
}

const description = `版本 ${ver}。安装包由该 git tag 构建,本页是正式发布。\n\n不可商用。商业使用必须先联系作者 x007007007@hotmail.com 取得书面授权。`;
console.log(`创建 GitLab Release ${tag}`);
const created = await gitlab(
  'POST',
  `/projects/${projectId}/releases`,
  JSON.stringify({ name: tag, tag_name: tag, description, assets: { links } }),
  'application/json',
);
assert.ok(created.status === 200 || created.status === 201, `创建 Release 失败 HTTP ${created.status}: ${created.text.slice(0, 500)}`);
console.log(JSON.parse(created.text).tag_name);

/** @param {string} name */
async function lookupFileId(name) {
  const query = new URLSearchParams({
    package_type: 'generic',
    package_name: 'redmine-bug-recorder',
    package_version: tag,
  });
  const pkgs = await gitlab('GET', `/projects/${projectId}/packages?${query}`);
  assert.equal(pkgs.status, 200, pkgs.text.slice(0, 300));
  const packages = JSON.parse(pkgs.text);
  assert.ok(packages.length > 0, `上传 ${name} 后没有找到包`);
  const files = await gitlab('GET', `/projects/${projectId}/packages/${packages[0].id}/package_files`);
  assert.equal(files.status, 200, files.text.slice(0, 300));
  const ids = JSON.parse(files.text).filter((item) => item.file_name === name).map((item) => item.id);
  assert.ok(ids.length > 0, `包里没有 ${name}`);
  return Math.max(...ids);
}
