// 单元测试：用 esbuild 把 tests/*.test.ts 打成单文件，再交给 node --test。
// 源码导入不带扩展名，Node 不能直接跑这些 TS 文件。

import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { readdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = path.join(root, 'tests');
const sources = (await readdir(testsDir)).filter((name) => name.endsWith('.test.ts')).sort();
if (!sources.length) {
  console.error('tests/ 下没有 *.test.ts');
  process.exit(1);
}

const outdir = await mkdtemp(path.join(tmpdir(), 'bugrec-unit-'));
await build({
  entryPoints: sources.map((name) => path.join(testsDir, name)),
  outdir,
  outbase: testsDir,
  bundle: true,
  format: 'esm',
  platform: 'node',
  // 必须用 Node 自带的 test/assert，打进 bundle 后测试运行器看不到用例
  external: ['node:test', 'node:assert', 'node:assert/strict'],
  sourcemap: 'inline',
  target: 'node22',
  logLevel: 'warning',
});

const files = sources.map((name) => path.join(outdir, name.replace(/\.ts$/, '.js')));
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  stdio: 'inherit',
  cwd: root,
});

child.on('exit', (code) => process.exit(code ?? 1));
