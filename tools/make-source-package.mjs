// AMO 源码审查包:列出已跟踪源码(或在没有 git 的 CI 镜像里按忽略规则遍历),
// 附 REBUILD.md。有 git 时工作区必须干净。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cp, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipDir } from './zip-dir.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skipDirs = new Set([
  'node_modules', 'dist', 'release', '.git',
  '.release-ff-stage', '.release-chrome-stage', '.release-src-stage',
  'web-ext-artifacts', '.idea', '.vscode', '__pycache__',
]);

/** @param {string[]} args */
function git(args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

/** @param {string} dir @param {string} prefix */
async function walk(dir, prefix) {
  /** @type {string[]} */
  const files = [];
  for (const name of await readdir(dir)) {
    if (skipDirs.has(name)) continue;
    const abs = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (rel.endsWith('.zip') || rel.endsWith('.xpi') || rel.endsWith('.pyc') || rel.endsWith('.tsbuildinfo') || rel.endsWith('.swp') || name === '.DS_Store') {
      continue;
    }
    const info = await stat(abs);
    if (info.isDirectory()) files.push(...await walk(abs, rel));
    else files.push(rel);
  }
  return files;
}

async function sourceFiles() {
  const status = git(['status', '--porcelain']);
  const hasGit = status.error?.code !== 'ENOENT';
  if (!hasGit) {
    if (!process.env.CI_COMMIT_TAG) {
      console.error('✗ 没有 git,无法在本地打源码包');
      process.exit(1);
    }
    return walk(root, '');
  }
  if (status.status !== 0) {
    console.error(status.stderr || status.stdout);
    process.exit(1);
  }
  if (status.stdout.trim()) {
    console.error('✗ 工作区有未提交改动,请先 commit 再打源码包:\n' + status.stdout);
    process.exit(1);
  }
  const listed = git(['ls-files', '-z']);
  if (listed.status !== 0) {
    console.error(listed.stderr || 'git ls-files 失败');
    process.exit(1);
  }
  return listed.stdout.split('\0').filter(Boolean);
}

const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const ver = manifest.version;
const stage = path.join(root, '.release-src-stage');
const out = path.join(root, 'release', `bug-recorder-source-v${ver}.zip`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

for (const rel of await sourceFiles()) {
  const dest = path.join(stage, rel);
  mkdirSync(path.dirname(dest), { recursive: true });
  await cp(path.join(root, rel), dest);
}

const rebuild = `# 重新构建说明(供 AMO 审核员使用)

本附加组件的分发 xpi 由 TypeScript 源码经 esbuild 打包生成,未做压缩混淆。

## 构建步骤

1. 安装 Node.js ≥ 20
2. 在源码根目录执行:
   npm install
   npm run release
3. 产物在 release/ 下:bug-recorder-firefox-v${ver}.xpi 即与提交的分发包一致
   (也可用 diff 对比包内文件)

## 结构说明

- shared/ background/ content/ manager/ popup/ devtools/ 为 TypeScript 源码
- manifest.firefox.json 为 Firefox 清单(构建时作为包内 manifest.json)
- tools/make-release.mjs 为打包脚本
`;
writeFileSync(path.join(stage, 'REBUILD.md'), rebuild);

mkdirSync(path.join(root, 'release'), { recursive: true });
rmSync(out, { force: true });
await zipDir(stage, out);
rmSync(stage, { recursive: true, force: true });

if (!existsSync(out)) {
  console.error('✗ 打包失败');
  process.exit(1);
}
console.log(`source package ready: ${out} (${(readFileSync(out).length / 1024).toFixed(0)} KB)`);
