// 代码复杂度分析:typhonjs-escomplex(内置 babel 解析器,直接吃 TS 源码)统计圈复杂度。
// 用法: node tools/complexity.mjs [目录...] (缺省扫描全部源码目录)
// 输出: 文件级汇总 + 函数级明细(按圈复杂度降序),便于重构前定位热点。
import escomplex from 'typhonjs-escomplex';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIRS = ['background', 'content', 'shared', 'popup', 'manager', 'devtools', 'note', 'options'];
const dirs = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_DIRS;

function collectTsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.d.ts')) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collectTsFiles(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const files = dirs.flatMap((d) => {
  const abs = path.join(root, d);
  try {
    return collectTsFiles(abs);
  } catch {
    return [];
  }
});

const methods = [];
const fileRows = [];

for (const file of files) {
  const rel = path.relative(root, file);
  let report;
  try {
    report = escomplex.analyzeModule(readFileSync(file, 'utf8'));
  } catch {
    // 老 babel 解析器不吃新语法(?? / ?. 等)时,退回 esbuild 降级转译再解析
    const { transformSync } = await import('esbuild');
    const js = transformSync(readFileSync(file, 'utf8'), { loader: 'ts', target: 'es2018', format: 'esm' }).code;
    try {
      report = escomplex.analyzeModule(js);
    } catch (err) {
      console.error(`skip ${rel}: ${err.message}`);
      continue;
    }
  }
  const agg = report.aggregate;
  fileRows.push({ file: rel, cyclomatic: agg.cyclomatic, sloc: agg.sloc.logical, methods: report.methods.length });
  for (const m of report.methods) {
    methods.push({ file: rel, name: m.name, cyclomatic: m.cyclomatic, sloc: m.sloc.logical, line: m.lineStart });
  }
}

methods.sort((a, b) => b.cyclomatic - a.cyclomatic || b.sloc - a.sloc);
fileRows.sort((a, b) => b.cyclomatic - a.cyclomatic || b.sloc - a.sloc);

console.log('=== 函数级圈复杂度 Top 25 ===');
for (const m of methods.slice(0, 25)) {
  console.log(`${String(m.cyclomatic).padStart(4)}  ${String(m.sloc).padStart(4)}行  ${m.file}:${m.line}  ${m.name}`);
}

console.log('\n=== 文件级汇总(圈复杂度合计 / 逻辑行) ===');
for (const f of fileRows.slice(0, 20)) {
  console.log(`${String(f.cyclomatic).padStart(4)}  ${String(f.sloc).padStart(5)}行  ${f.methods}个函数  ${f.file}`);
}

const total = methods.reduce((s, m) => s + m.cyclomatic, 0);
const avg = methods.length ? (total / methods.length).toFixed(2) : '0';
console.log(`\n共 ${files.length} 个文件 / ${methods.length} 个函数,平均圈复杂度 ${avg}`);
