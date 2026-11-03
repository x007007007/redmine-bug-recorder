// AMO 源码审查包:AMO 对"构建生成"的代码经常要求同时提交源码。
// 用 git archive 打 HEAD(自动遵循 .gitignore,不含 node_modules/dist/release),
// 附 REBUILD.md(精确构建步骤)。要求:提交前工作区干净,否则拒绝打包并提示。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 1. 工作区必须干净(源码包要能精确复现 xpi)
const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
if (status.trim()) {
  console.error('✗ 工作区有未提交改动,请先 commit 再打源码包:\n' + status);
  process.exit(1);
}

// 2. 版本号
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const ver = manifest.version;

// 3. git archive → 临时目录 → 注入 REBUILD.md → 打 zip
const stage = path.join(root, '.release-src-stage');
const out = path.join(root, 'release', `bug-recorder-source-v${ver}.zip`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
execFileSync('git', ['archive', '--format=zip', '--output', path.join(stage, 'src.zip'), 'HEAD'], { cwd: root });
execFileSync('unzip', ['-q', path.join(stage, 'src.zip'), '-d', stage], { cwd: root });
rmSync(path.join(stage, 'src.zip'));

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
execFileSync('zip', ['-rqy', out, '.'], { cwd: stage });
rmSync(stage, { recursive: true, force: true });

if (!existsSync(out)) {
  console.error('✗ 打包失败');
  process.exit(1);
}
console.log(`source package ready: ${out} (${(readFileSync(out).length / 1024).toFixed(0)} KB)`);
