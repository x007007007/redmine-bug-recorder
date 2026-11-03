// 构建脚本:src-in-place 的 TS 源码 → dist/(镜像目录结构,浏览器可直接"加载已解压"的目录)。
// 入口全部打成自包含单文件:
//   background → ESM(带 type:module 的 service worker)
//   content    → IIFE 经典脚本(原 dom-meta / probe-serialize 由打包内联,不再单独列文件)
//   页面       → ESM(popup / manager / devtools panel 均以 <script type=module> 引入)
import { build } from 'esbuild';
import { cp, mkdir, readdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

const COMMON = {
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  target: ['chrome120', 'firefox128'],
  legalComments: 'none',
};

function firefoxCdpStub() {
  const stub = path.join(root, 'background/net-cdp-firefox.ts');
  return {
    name: 'firefox-cdp-stub',
    setup(buildApi) {
      buildApi.onResolve({ filter: /(?:^|\/)net-cdp$/ }, () => ({ path: stub }));
    },
  };
}

const entries = [
  { in: 'background/service-worker.ts', out: 'background/service-worker.js', format: 'esm' },
  {
    in: 'background/service-worker.ts',
    out: 'background/service-worker.firefox.js',
    format: 'esm',
    plugins: [firefoxCdpStub()],
  },
  { in: 'content/console-hook.ts', out: 'content/console-hook.js', format: 'iife' },
  { in: 'content/recorder.ts', out: 'content/recorder.js', format: 'iife' },
  { in: 'content/vue-probe.ts', out: 'content/vue-probe.js', format: 'iife' },
  { in: 'popup/popup.ts', out: 'popup/popup.js', format: 'esm' },
  { in: 'manager/manager.ts', out: 'manager/manager.js', format: 'esm' },
  { in: 'devtools/devtools.ts', out: 'devtools/devtools.js', format: 'iife' },
  { in: 'devtools/panel.ts', out: 'devtools/panel.js', format: 'iife' },
  { in: 'note/note.ts', out: 'note/note.js', format: 'esm' },
];

async function copyStatic() {
  // 清理重建 dist
  if (existsSync(dist)) await import('node:fs').then((m) => m.rmSync(dist, { recursive: true, force: true }));
  await mkdir(dist, { recursive: true });
  for (const f of ['manifest.json', 'manifest.firefox.json']) {
    await copyFile(path.join(root, f), path.join(dist, f));
  }
  await cp(path.join(root, 'icons'), path.join(dist, 'icons'), { recursive: true });
  // 各页面的 html/css 原样拷贝
  for (const dir of ['popup', 'manager', 'devtools', 'note']) {
    await mkdir(path.join(dist, dir), { recursive: true });
    for (const f of await readdir(path.join(root, dir))) {
      if (f.endsWith('.html') || f.endsWith('.css')) {
        await copyFile(path.join(root, dir, f), path.join(dist, dir, f));
      }
    }
  }
}

await copyStatic();

if (watch) {
  const contexts = await Promise.all(
    entries.map((e) =>
      build({
        ...COMMON,
        entryPoints: [path.join(root, e.in)],
        outfile: path.join(dist, e.out),
        format: e.format,
        plugins: e.plugins,
        watch: true,
      })
    )
  );
  console.log('watching…');
  process.on('SIGINT', () => {
    for (const c of contexts) c.dispose();
    process.exit(0);
  });
} else {
  for (const e of entries) {
    await build({
      ...COMMON,
      entryPoints: [path.join(root, e.in)],
      outfile: path.join(dist, e.out),
      format: e.format,
      plugins: e.plugins,
    });
  }
  console.log('build done → dist/');
}
