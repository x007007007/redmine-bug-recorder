// 录制器内容脚本(隔离世界):捕获点击 / 键盘输入(防抖) / 选择 / 表单提交,
// 并通过 CustomEvent 向主世界探针(vue-probe.js)请求 Vue 组件 / Pinia 信息,合并后发给后台。
// 值不做脱敏(按需求:上传前由测试人员在管理页 review 勾选),仅做长度截断。
(() => {
  if (window.__bugRecorderInstalled) return;
  window.__bugRecorderInstalled = true;

  const MAX_VALUE = 1000;        // 输入值截断上限(完整值尽量保留,review 时可见)
  const KEYBOARD_DEBOUNCE = 700; // 连续敲键合并成一条输入步骤

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

  // 生成较稳定的 CSS 选择器:优先 id / data-testid / name,否则向上构造路径
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

  function baseMeta(el) {
    return {
      url: location.href,
      title: document.title || '',
      ts: Date.now(),
      selector: el ? cssPath(el) : '',
      label: el ? fieldLabel(el) || textOf(el) : '',
      vue: collectVueInfo(el),
    };
  }

  /* ---------- 主世界探针桥(同步一轮 CustomEvent) ---------- */

  let probeSeq = 0;

  function collectVueInfo(el) {
    if (!el || !el.setAttribute) return null;
    const id = 'v' + ++probeSeq;
    let info = null;
    const onInfo = (e) => {
      info = e.detail || null;
    };
    try {
      el.setAttribute('data-bugrec-eid', id);
      document.addEventListener('bugrec:vue-info', onInfo, { once: true });
      document.dispatchEvent(new CustomEvent('bugrec:probe', { detail: { id } }));
      document.removeEventListener('bugrec:vue-info', onInfo);
    } catch {
      /* 探针不可用时静默降级 */
    }
    return info;
  }

  function send(action) {
    try {
      const p = chrome.runtime.sendMessage({ type: 'REC_ACTION', action });
      if (p && p.catch) p.catch(() => {}); // 扩展重载后旧页面 sendMessage 会失败,静默忽略
    } catch {
      /* Invalid extension context */
    }
  }

  const TEXT_INPUT =
    'input[type=text],input[type=search],input[type=number],input[type=email],input[type=url],input[type=tel],input[type=password],input:not([type]),textarea';

  /* ---------- 点击 ---------- */

  const INTERACTIVE =
    'a,button,input,select,textarea,label,[role="button"],[role="menuitem"],[role="tab"],summary,option';

  document.addEventListener(
    'click',
    (e) => {
      if (!(e.target instanceof Element)) return;
      const el = e.target.closest(INTERACTIVE) || e.target;
      const action = Object.assign({ kind: 'click' }, baseMeta(el));
      if (el.tagName === 'A' && el.href) action.href = el.href;
      const tag = el.tagName;
      if (tag === 'SELECT') {
        const opt = el.selectedOptions && el.selectedOptions[0];
        action.inputType = 'select';
        action.value = truncate(opt ? opt.textContent : el.value, 80);
      } else if (tag === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
        action.inputType = el.type;
        action.value = el.checked ? '选中' : '取消';
      } else if (tag === 'INPUT' && el.type !== 'submit' && el.type !== 'button' && el.type !== 'image') {
        action.inputType = el.type || 'text';
        action.value = truncate(el.value);
      } else if (tag === 'TEXTAREA') {
        action.inputType = 'textarea';
        action.value = truncate(el.value);
      } else if (tag === 'INPUT' && el.type === 'file') {
        action.inputType = 'file';
        action.value = '[文件]';
      }
      send(action);
    },
    true
  );

  /* ---------- 键盘输入(防抖合并)+ 回车单独记一步 ---------- */

  const pendingInputs = new WeakMap();

  function flushPending(el) {
    const timer = pendingInputs.get(el);
    if (timer) {
      clearTimeout(timer);
      pendingInputs.delete(el);
      recordKeyboard(el);
    }
  }

  function recordKeyboard(el) {
    const action = Object.assign(
      { kind: 'input', inputType: 'keyboard', value: truncate(el.value) },
      baseMeta(el)
    );
    send(action);
  }

  document.addEventListener(
    'input',
    (e) => {
      const el = e.target;
      if (!(el instanceof Element) || !el.matches(TEXT_INPUT)) return;
      clearTimeout(pendingInputs.get(el));
      pendingInputs.set(
        el,
        setTimeout(() => {
          pendingInputs.delete(el);
          recordKeyboard(el);
        }, KEYBOARD_DEBOUNCE)
      );
    },
    true
  );

  document.addEventListener(
    'keydown',
    (e) => {
      const el = e.target;
      if (!(el instanceof Element) || !el.matches('input,textarea')) return;
      if (e.key === 'Enter' || e.key === 'Escape') {
        flushPending(el); // 先把未定稿的输入落成一条步骤
        send(Object.assign({ kind: 'keypress', key: e.key }, baseMeta(el)));
      }
    },
    true
  );

  /* ---------- select 变化(change) ---------- */

  document.addEventListener(
    'change',
    (e) => {
      const el = e.target;
      if (!(el instanceof Element)) return;
      if (!el.matches('select')) return; // 文本输入走键盘防抖;checkbox/radio 走 click
      const opt = el.selectedOptions && el.selectedOptions[0];
      send(
        Object.assign(
          { kind: 'input', inputType: 'select', value: truncate(opt ? opt.textContent : el.value, 80) },
          baseMeta(el)
        )
      );
    },
    true
  );

  /* ---------- 表单提交 ---------- */

  document.addEventListener(
    'submit',
    (e) => {
      const form = e.target;
      if (!(form instanceof Element)) return;
      const fields = [];
      try {
        form.querySelectorAll('input,textarea,select').forEach((f) => {
          if (f.type === 'file') return;
          fields.push(`${fieldLabel(f) || cssPath(f)}=${truncate(f.value, 200)}`);
        });
      } catch {
        /* 忽略复杂表单取值失败 */
      }
      send(Object.assign({ kind: 'submit', value: truncate(fields.join('; '), 600) }, baseMeta(form)));
    },
    true
  );

  /* ---------- 主世界 Pinia 变更流 → 后台(按时间关联到步骤) ---------- */

  document.addEventListener('bugrec:pinia', (e) => {
    try {
      const p = chrome.runtime.sendMessage({ type: 'REC_PINIA', event: e.detail });
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* ignore */
    }
  });
})();
