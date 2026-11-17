// 一键启动本地测试环境:
//   node tools/dev-launch.mjs chrome   → 构建 + demo 服务器 + Chrome(加载 dist/,打开 demo 页和管理页)
//   node tools/dev-launch.mjs firefox  → 构建 + demo 服务器 + Firefox(web-ext 加载暂存目录,改码自动重载)
//   node tools/dev-launch.mjs both     → 两个浏览器同时启动
// 选项:
//   --no-build          跳过构建(刚构建过时提速)
//   --page URL          追加要打开的页面(可重复;默认 demo 首页 + Vue 页 + 管理页)
//   --cdp-port=9223     Chrome 开调试端口,配合 npm run smoke 端到端冒烟测试
//   --dry-run           只暂存/打印将执行的命令,不启动浏览器、不动端口
// 浏览器路径:默认探测 /Applications,可用 CHROME_BIN / FIREFOX_BIN 覆盖。
// Firefox 侧需要把 dist 暂存为 .dev-firefox(manifest 换 firefox 版、后台脚本换无 debugger 版),
// 与 tools/make-release.mjs 的 xpi 打包同一套规则;web-ext 监听该目录自动重载。
import net from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const ffStage = path.join(root, '.dev-firefox');
const chromeProfile = path.join(root, '.dev-profile', 'chrome');
const DEMO_PORT = 8123;
const REDMINE_PORT = 8124;
const DEMO_BASE = `http://127.0.0.1:${DEMO_PORT}`;

const args = process.argv.slice(2);
const names = args.filter((a) => ['chrome', 'firefox', 'both'].includes(a));
const target = names.includes('both') ? 'both' : (names[0] || 'chrome');
const noBuild = args.includes('--no-build');
const dryRun = args.includes('--dry-run');
const extraPages = args.filter((a) => a.startsWith('http'));
const cdpPort = Number(args.find((a) => a.startsWith('--cdp-port='))?.split('=')[1]) || 0;

const DEFAULT_PAGES_CHROME = [
  `${DEMO_BASE}/`,
  `${DEMO_BASE}/vue.html`,
  // manifest 带 key,Chrome 扩展 ID 稳定,可直接打开扩展内管理页
  `chrome-extension://bkeogdmbgodhopooimgmbacldmdmpeap/manager/manager.html`,
];
const DEFAULT_PAGES_FIREFOX = [
  `${DEMO_BASE}/`,
  `${DEMO_BASE}/vue.html`,
  // Firefox 扩展页是 moz-extension://<随机UUID>/,不可预知;devtools 面板会随 --devtools 自动打开
];
const defaultPagesFor = (t) => (t === 'firefox' ? DEFAULT_PAGES_FIREFOX : DEFAULT_PAGES_CHROME);

/**
 * Chrome 加载扩展的可用性(2025 实测):
 *  - 品牌版 Google Chrome ≥137:--load-extension 被移除,扩展被"屏蔽",任何版本开关都救不回
 *  - Chrome for Testing / Chromium / Dev 渠道:可用,但必须开启"开发者模式"
 *    (extensions.ui.developer_mode),否则扩展加载后保持禁用(页面报"已被 Chromium 屏蔽")
 * 候选按优先级排:CHROME_BIN → 缓存的 CfT(最新优先)→ Chromium/Dev/Beta/Canary → 稳定版兜底。
 */
function chromeCandidates() {
  const cftBins = [];
  const pushCftDir = (dir, glob) => {
    try {
      const versions = readdirSync(dir)
        .filter((d) => glob.test(d))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const v of versions) {
        const bin = path.join(dir, v, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
        if (existsSync(bin)) cftBins.push(bin);
      }
    } catch {
      /* 目录不存在,忽略 */
    }
  };
  pushCftDir(path.join(process.env.HOME || '', '.cache/puppeteer/chrome'), /^mac_arm-/);
  pushCftDir(path.join(process.env.HOME || '', 'Library/Caches/ms-playwright/chrome'), /.*/);
  pushCftDir(path.join(process.env.HOME || '', 'Library/Caches/ms-playwright'), /^chromium-\d+$/);
  return [
    process.env.CHROME_BIN,
    ...cftBins,
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev',
    '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
}

const BRANDED_BLOCK_MAJOR = 137; // 品牌版 Chrome 从此版本起屏蔽 --load-extension

function chromeMajorVersion(bin) {
  return new Promise((resolve) => {
    const child = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout?.on('data', (d) => (out += d));
    child.on('exit', () => resolve(Number((out.match(/(\d+)\./) || [])[1]) || 0));
    child.on('error', () => resolve(0));
  });
}

/** 品牌版稳定 Chrome(封禁渠道);for Testing/Chromium/Dev 渠道不受限 */
function isBrandedStable(bin) {
  return bin.includes('Google Chrome.app') && !/for Testing|Dev|Beta|Canary|Chromium/.test(bin);
}

async function pickChrome() {
  const candidates = chromeCandidates();
  if (!candidates.length) die('找不到 Chrome/Chromium,请设置 CHROME_BIN');
  // 品牌稳定版放最后兜底,其余按优先级取第一个可用的
  const ordered = [...candidates.filter((b) => !isBrandedStable(b)), ...candidates.filter(isBrandedStable)];
  const bin = ordered[0];
  const major = await chromeMajorVersion(bin);
  const blocked = isBrandedStable(bin) && major >= BRANDED_BLOCK_MAJOR;
  return { bin, major, blocked };
}

/** 预置"开发者模式":未打包扩展只在 developer_mode 开启时才真正运行 */
async function seedChromeProfile() {
  const defaultDir = path.join(chromeProfile, 'Default');
  await mkdir(defaultDir, { recursive: true });
  const prefsPath = path.join(defaultDir, 'Preferences');
  let prefs = {};
  try {
    if (existsSync(prefsPath)) prefs = JSON.parse(await readFile(prefsPath, 'utf8'));
  } catch {
    prefs = {};
  }
  prefs.extensions ??= {};
  prefs.extensions.ui ??= {};
  prefs.extensions.ui.developer_mode = true;
  prefs.profile ??= {};
  prefs.profile.exit_type = 'Normal';
  prefs.profile.exited_cleanly = true;
  await writeFile(prefsPath, JSON.stringify(prefs));
}
const FIREFOX_CANDIDATES = [
  process.env.FIREFOX_BIN,
  '/Applications/Firefox.app/Contents/MacOS/firefox',
  '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox',
].filter(Boolean);

const firstExisting = (paths) => paths.find((p) => existsSync(p));
const die = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let demoServer = null; // 本次拉起的服务器,退出时回收

function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('error', () => resolve(false));
  });
}

/** demo 服务器(8123 应用页 + 8124 假 Redmine):已有实例就复用,否则拉起;--dry-run 不动端口 */
async function ensureServers() {
  if (dryRun) return;
  const targets = [
    { port: DEMO_PORT, mode: [], label: '应用演示页' },
    { port: REDMINE_PORT, mode: ['redmine'], label: '假 Redmine' },
  ];
  for (const { port, mode, label } of targets) {
    if (await portOpen(port)) {
      console.log(`${label}(${port})已在运行,直接复用`);
      continue;
    }
    if (!existsSync(path.join(root, 'demo/server.py'))) die('找不到 demo/server.py');
    demoServer = spawn('python3', ['demo/server.py', ...mode], { cwd: root, stdio: 'ignore' });
    const deadline = Date.now() + 5000;
    let ready = false;
    while (Date.now() < deadline) {
      if (await portOpen(port)) {
        ready = true;
        break;
      }
      await sleep(100);
    }
    if (!ready) die(`${label} 5 秒内未就绪`);
    console.log(`${label}就绪: http://127.0.0.1:${port}`);
  }
}

function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { cwd: root, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}`))));
    child.on('error', reject);
  });
}

async function build() {
  if (noBuild) {
    if (!existsSync(path.join(dist, 'manifest.json'))) die('dist/ 不存在,先去掉 --no-build 或跑 npm run build');
    console.log('--no-build,跳过构建');
    return;
  }
  console.log('构建 dist/ …');
  await run('node', ['build.mjs']);
}

/** Firefox 暂存目录:manifest 换 firefox 版 + 无 debugger 后台脚本(与 make-release 同规则) */
async function stageFirefox() {
  const ffManifestSrc = path.join(root, 'manifest.firefox.json');
  if (!existsSync(ffManifestSrc)) die('找不到 manifest.firefox.json');
  if (!existsSync(path.join(dist, 'manifest.json'))) die('dist/ 不存在,请先构建');
  await rm(ffStage, { recursive: true, force: true });
  await cp(dist, ffStage, { recursive: true });
  await rm(path.join(ffStage, 'manifest.json'));
  await cp(ffManifestSrc, path.join(ffStage, 'manifest.json'));
  const ffSw = path.join(ffStage, 'background/service-worker.firefox.js');
  if (!existsSync(ffSw)) die('dist 缺 background/service-worker.firefox.js,请完整构建');
  await rm(path.join(ffStage, 'background/service-worker.js'));
  await cp(ffSw, path.join(ffStage, 'background/service-worker.js'));
  console.log(`Firefox 暂存就绪: ${ffStage}`);
}

function cleanupAndExit(code) {
  if (demoServer) demoServer.kill();
  process.exit(code);
}

async function launchChrome() {
  const { bin, major, blocked } = await pickChrome();
  console.log(`选用浏览器: ${bin}${major ? ` (Chrome ${major})` : ''}`);
  if (blocked) {
    console.warn(`⚠ 品牌版 Chrome ≥ ${BRANDED_BLOCK_MAJOR} 已移除 --load-extension,扩展会被 Chromium 屏蔽。`);
    console.warn('  请安装 Chrome for Testing(npx @puppeteer/browsers install chrome@stable)或改用 npm run dev:firefox。');
  }
  const pages = [...defaultPagesFor('chrome'), ...extraPages];
  const argv = [
    `--user-data-dir=${chromeProfile}`,
    `--load-extension=${dist}`,
    `--disable-extensions-except=${dist}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    ...(cdpPort ? [`--remote-debugging-port=${cdpPort}`] : []),
    ...pages,
  ];
  if (dryRun) {
    console.log(`[dry-run] "${bin}" ${argv.join(' ')}`);
    return;
  }
  await seedChromeProfile();
  console.log(`启动 Chrome(独立 profile: ${chromeProfile}${cdpPort ? `,CDP ${cdpPort}` : ''},不影响日常浏览器)`);
  // detached:脚本退出/重启时测试窗口保留,扩展改动需在 chrome://extensions 里刷新
  const child = spawn(bin, argv, { stdio: 'ignore', detached: true });
  child.unref();
  if (cdpPort) {
    const deadline = Date.now() + 15000; // 首次冷启动(建 profile)可能 >5s
    while (Date.now() < deadline) {
      if (await portOpen(cdpPort)) {
        console.log(`CDP 调试端口就绪: http://127.0.0.1:${cdpPort}(可跑 npm run smoke)`);
        return;
      }
      await sleep(100);
    }
    console.error('⚠ CDP 端口未就绪,冒烟测试可能连不上');
  }
}

async function launchFirefox() {
  const bin = firstExisting(FIREFOX_CANDIDATES);
  const webExt = path.join(root, 'node_modules/.bin/web-ext');
  if (!existsSync(webExt)) die('找不到 web-ext,请 npm install');
  await stageFirefox();
  const pages = [...defaultPagesFor('firefox'), ...extraPages];
  const argv = [
    'run',
    `--source-dir=${ffStage}`,
    ...(bin ? [`--firefox=${bin}`] : []),
    ...pages.map((u) => `--url=${u}`),
    '--devtools',
    '--browser-console',
  ];
  if (dryRun) {
    console.log(`[dry-run] ${webExt} ${argv.join(' ')}`);
    return;
  }
  console.log('启动 Firefox(web-ext 热重载;关窗口或 Ctrl+C 结束)');
  // web-ext 挂前台,由它管理 Firefox;退出后回收 demo 服务器
  await new Promise((resolve, reject) => {
    const child = spawn(webExt, argv, { cwd: root, stdio: 'inherit' });
    child.on('exit', resolve);
    child.on('error', reject);
  });
  cleanupAndExit(0);
}

async function main() {
  process.on('SIGINT', () => cleanupAndExit(0));
  await build();
  await ensureServers();

  if (target === 'chrome' || target === 'both') await launchChrome();
  if (target === 'firefox' || target === 'both') {
    await launchFirefox();
    return;
  }
  // chrome 模式:脚本留守管理 demo 服务器,Ctrl+C 退出(Chrome 窗口保留)
  if (!dryRun) console.log('(Ctrl+C 退出并关闭 demo 服务器;Chrome 窗口保留,扩展改动需在 chrome://extensions 刷新)');
  await new Promise(() => {}); // 常驻直到 Ctrl+C
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  cleanupAndExit(1);
});
