// 同时改 manifest.json、manifest.firefox.json、package.json 的 version。
// git tag 不在这里移动：已发布的 tag 保持原提交。推到 main 后，由 GitHub Actions 在 tag 不存在时创建 vX.Y.Z。
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
assert.match(version ?? '', /^\d+\.\d+\.\d+$/, '用法: node tools/set-version.mjs 0.2.5');

const files = ['manifest.json', 'manifest.firefox.json', 'package.json'];
for (const name of files) {
  const file = path.join(root, name);
  const text = readFileSync(file, 'utf8');
  assert.match(text, /"version"\s*:\s*"\d+\.\d+\.\d+"/, `${name} 缺少 version`);
  const next = text.replace(/("version"\s*:\s*")\d+\.\d+\.\d+(")/, `$1${version}$2`);
  writeFileSync(file, next);
}
console.log(`version ${version}`);
