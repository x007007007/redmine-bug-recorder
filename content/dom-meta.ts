// DOM 元数据工具(隔离世界):选择器生成、字段标签、值截断。
// 供 recorder.ts 以模块方式引入,构建时内联为单个 IIFE 经典脚本。

import { t } from '../shared/i18n';

const MAX_VALUE = 1000;
const MAX_DEPTH = 5;

export function truncate(s: unknown, n: number = MAX_VALUE): string {
  const str = String(s == null ? '' : s);
  return str.length > n ? t('truncChars', [str.slice(0, n), String(str.length)]) : str;
}

export function textOf(el: Element): string {
  return (el instanceof HTMLElement ? el.innerText : el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
}

function firstLabel(...candidates: (Element | null | undefined)[]): string {
  for (const c of candidates) {
    if (c) return textOf(c);
  }
  return '';
}

/** 结构化关联的 label:input 的 labels 属性 → label[for] → 包裹的 <label> */
function labelFromDom(el: Element): string {
  const own = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el.labels?.[0] : undefined;
  const byId = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
  return firstLabel(own, byId, el.closest && el.closest('label'));
}

/** 无 label 时的属性兜底 */
function labelFromAttrs(el: Element): string {
  for (const name of ['aria-label', 'placeholder', 'title', 'name', 'alt']) {
    const v = el.getAttribute(name);
    if (v) return v;
  }
  return '';
}

export function fieldLabel(el: Element): string {
  try {
    return labelFromDom(el) || labelFromAttrs(el);
  } catch {
    return '';
  }
}

interface PathPart {
  text: string;
  /** 命中全页唯一 id,路径到此为止 */
  terminal: boolean;
}

/** 单层选择器片段:优先 id(需全页唯一) / data-testid / name,否则 nth-of-type */
function pathPart(cur: Element, parent: Element | null): PathPart {
  let part = cur.tagName.toLowerCase();
  if (cur.id && isUniqueInDocument(cur.id)) {
    return { text: part + '#' + CSS.escape(cur.id), terminal: true };
  }
  const testid = (cur as HTMLElement).dataset?.testid;
  if (testid) part += `[data-testid="${testid}"]`;
  else if (cur.getAttribute('name')) part += `[name="${cur.getAttribute('name')}"]`;
  else {
    const idx = nthOfType(cur, parent);
    if (idx > 0) part += `:nth-of-type(${idx})`;
  }
  return { text: part, terminal: false };
}

function isUniqueInDocument(id: string): boolean {
  try {
    return document.querySelectorAll('#' + CSS.escape(id)).length === 1;
  } catch {
    return false; // id 不合法则忽略
  }
}

/** 同类兄弟中的序号(1 起);没有同名兄弟或唯一时返回 0,不写 nth-of-type */
function nthOfType(cur: Element, parent: Element | null): number {
  if (!parent) return 0;
  let count = 0;
  let index = 0;
  for (const c of parent.children) {
    if (c.tagName !== cur.tagName) continue;
    count += 1;
    if (c === cur) index = count;
  }
  return count > 1 ? index : 0;
}

/** 较稳定的 CSS 选择器:优先 id / data-testid / name,否则向上构造路径 */
export function cssPath(el: Element): string {
  if (!(el instanceof Element)) return String(el);
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && parts.length < MAX_DEPTH) {
    const part = pathPart(cur, cur.parentElement);
    parts.unshift(part.text);
    if (part.terminal) break;
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}
