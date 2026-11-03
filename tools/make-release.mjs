// 把已经构建好的 dist/ 打成两个商店包,写到 release/:
//   bug-recorder-chrome-v{ver}.zip   (Chrome Web Store,manifest.json)
//   bug-recorder-firefox-v{ver}.xpi  (AMO,manifest.firefox.json 作为包内 manifest.json)
// 构建本身由 build.mjs 完成,这里不再另写一套入口,避免漏文件。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const release = path.join(root, 'release');

assert.ok(existsSync(path.join(dist, 'manifest.json')), 'dist/manifest.json 不存在,请先 npm run build');
assert.ok(existsSync(path.join(dist, 'content/console-hook.js')), 'dist 缺少 content/console-hook.js');

const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'));
const firefoxManifest = JSON.parse(await readFile(path.join(root, 'manifest.firefox.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(firefoxManifest.version, manifest.version, 'manifest.firefox.json 版本与 manifest.json 不一致');
assert.equal(pkg.version, manifest.version, 'package.json 版本与 manifest.json 不一致');

const ver = manifest.version;

await rm(release, { recursive: true, force: true });
await mkdir(release, { recursive: true });

/** @param {string} srcDir @param {string} outFile */
function zipDir(srcDir, outFile) {
  execFileSync('zip', ['-rq', path.resolve(outFile), '.'], { cwd: srcDir, stdio: 'inherit' });
}

/**
 * @param {string} stageDir
 * @param {'chrome' | 'firefox'} target
 */
async function stage(stageDir, target) {
  await rm(stageDir, { recursive: true, force: true });
  await cp(dist, stageDir, { recursive: true });
  await rm(path.join(stageDir, 'manifest.firefox.json'), { force: true });
  if (target === 'firefox') {
    await rm(path.join(stageDir, 'manifest.json'));
    await cp(path.join(root, 'manifest.firefox.json'), path.join(stageDir, 'manifest.json'));
  }
}

const chromeStage = path.join(root, '.release-chrome-stage');
const firefoxStage = path.join(root, '.release-ff-stage');
await stage(chromeStage, 'chrome');
await stage(firefoxStage, 'firefox');
zipDir(chromeStage, path.join(release, `bug-recorder-chrome-v${ver}.zip`));
zipDir(firefoxStage, path.join(release, `bug-recorder-firefox-v${ver}.xpi`));
await rm(chromeStage, { recursive: true, force: true });
await rm(firefoxStage, { recursive: true, force: true });

console.log(`release ready (v${ver}):`);
for (const name of await readdir(release)) console.log('  ' + path.join(release, name));
