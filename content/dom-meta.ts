// DOM 元数据工具(隔离世界):选择器生成、字段标签、值截断。
// 供 recorder.ts 以模块方式引入,构建时内联为单个 IIFE 经典脚本。

import { t } from '../shared/i18n';

const MAX_VALUE = 1000;

export function truncate(s: unknown, n: number = MAX_VALUE): string {
  const str = String(s == null ? '' : s);
  return str.length > n ? t('truncChars', [str.slice(0, n), String(str.length)]) : str;
}

export function textOf(el: Element): string {
  return (el instanceof HTMLElement ? el.innerText : el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
}

export function fieldLabel(el: Element): string {
  try {
    if (el instanceof HTMLInputElement && el.labels && el.labels[0]) return textOf(el.labels[0]);
    if (el instanceof HTMLTextAreaElement && el.labels && el.labels[0]) return textOf(el.labels[0]);
    if (el instanceof HTMLSelectElement && el.labels && el.labels[0]) return textOf(el.labels[0]);
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return textOf(l);
    }
    const wrap = el.closest && el.closest('label');
    if (wrap) return textOf(wrap);
    return (
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      el.getAttribute('name') ||
      el.getAttribute('alt') ||
      ''
    );
  } catch {
    return '';
  }
}

/** 较稳定的 CSS 选择器:优先 id / data-testid / name,否则向上构造路径 */
export function cssPath(el: Element): string {
  if (!(el instanceof Element)) return String(el);
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && parts.length < 5) {
    let part = cur.tagName.toLowerCase();
    if (cur.id) {
      try {
        if (document.querySelectorAll('#' + CSS.escape(cur.id)).length === 1) {
          parts.unshift(part + '#' + CSS.escape(cur.id));
          break;
        }
      } catch {
        /* id 不合法则忽略 */
      }
    }
    const testid = (cur as HTMLElement).dataset?.testid;
    if (testid) {
      part += `[data-testid="${testid}"]`;
    } else if (cur.getAttribute('name')) {
      part += `[name="${cur.getAttribute('name')}"]`;
    } else {
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
    }
    parts.unshift(part);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}
