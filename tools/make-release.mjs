// 发布打包:构建 dist/ 后产出两个商店包到 release/:
//   bug-recorder-chrome-v{ver}.zip   (Chrome Web Store 用,dist 原样)
//   bug-recorder-firefox-v{ver}.xpi  (AMO 用,manifest.firefox.json 作为包内 manifest.json)
import { build } from 'esbuild';
import { cp, mkdir, readdir, copyFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const release = path.join(root, 'release');

// 1. 构建(与 build.mjs 相同的入口)
const COMMON = {
  bundle: true,
  sourcemap: true,
  logLevel: 'silent',
  target: ['chrome120', 'firefox128'],
  legalComments: 'none',
};
const entries = [
  { in: 'background/service-worker.ts', out: 'background/service-worker.js', format: 'esm' },
  { in: 'content/recorder.ts', out: 'content/recorder.js', format: 'iife' },
  { in: 'content/vue-probe.ts', out: 'content/vue-probe.js', format: 'iife' },
  { in: 'popup/popup.ts', out: 'popup/popup.js', format: 'esm' },
  { in: 'manager/manager.ts', out: 'manager/manager.js', format: 'esm' },
  { in: 'devtools/devtools.ts', out: 'devtools/devtools.js', format: 'iife' },
  { in: 'devtools/panel.ts', out: 'devtools/panel.js', format: 'esm' },
];
if (existsSync(dist)) await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const f of ['manifest.json', 'manifest.firefox.json']) {
  await copyFile(path.join(root, f), path.join(dist, f));
}
await cp(path.join(root, 'icons'), path.join(dist, 'icons'), { recursive: true });
for (const dir of ['popup', 'manager', 'devtools']) {
  await mkdir(path.join(dist, dir), { recursive: true });
  for (const f of await readdir(path.join(root, dir))) {
    if (f.endsWith('.html') || f.endsWith('.css')) {
      await copyFile(path.join(root, dir, f), path.join(dist, dir, f));
    }
  }
}
for (const e of entries) {
  await build({ ...COMMON, entryPoints: [path.join(root, e.in)], outfile: path.join(dist, e.out), format: e.format });
}

// 2. 版本号来自 Chrome manifest
const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'));
const ver = manifest.version;

// 3. 打包(release/ 不进 git)
await rm(release, { recursive: true, force: true });
await mkdir(release, { recursive: true });
const zip = (srcDir, outFile) =>
  execFileSync('zip', ['-rq', path.resolve(outFile), '.'], { cwd: srcDir, stdio: 'inherit' });

zip(dist, path.join(release, `bug-recorder-chrome-v${ver}.zip`));

// Firefox 包:firefox manifest 换名,且不含 Chrome 专属字段文件
const ffStage = path.join(root, '.release-ff-stage');
await rm(ffStage, { recursive: true, force: true });
await cp(dist, ffStage, { recursive: true });
await rm(path.join(ffStage, 'manifest.json'));
await cp(path.join(root, 'manifest.firefox.json'), path.join(ffStage, 'manifest.json'));
// Firefox 不支持 "key"(Chrome 专属),留着的校验问题——manifest.firefox.json 本就没有
zip(ffStage, path.join(release, `bug-recorder-firefox-v${ver}.xpi`));
await rm(ffStage, { recursive: true, force: true });

console.log(`release ready (v${ver}):`);
for (const f of await readdir(release)) console.log('  ' + path.join(release, f));
