// DOM 元数据工具(隔离世界):选择器生成、字段标签、值截断。
// 供 recorder.js 使用,以 var 命名空间共享(经典脚本同 realm 共享全局)。

var __bugrecMeta = (() => {
  const MAX_VALUE = 1000;

  function truncate(s, n = MAX_VALUE) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n) + `…(${s.length}字符)` : s;
  }

  function textOf(el) {
    return (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  }

  function fieldLabel(el) {
    try {
      if (el.labels && el.labels[0]) return textOf(el.labels[0]);
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

  // 较稳定的 CSS 选择器:优先 id / data-testid / name,否则向上构造路径
  function cssPath(el) {
    if (!(el instanceof Element)) return String(el);
    const parts = [];
    let cur = el;
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
      if (cur.dataset && cur.dataset.testid) {
        part += `[data-testid="${cur.dataset.testid}"]`;
      } else if (cur.getAttribute('name')) {
        part += `[name="${cur.getAttribute('name')}"]`;
      } else {
        const parent = cur.parentElement;
        if (parent) {
          const same = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
          if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
        }
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  return { truncate, textOf, fieldLabel, cssPath };
})();
