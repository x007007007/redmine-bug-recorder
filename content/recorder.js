// 录制器内容脚本(隔离世界):捕获点击 / 键盘输入(防抖) / 下拉 / 表单提交,
// 经 CustomEvent 向主世界探针请求 Vue/Pinia 信息后一并发给后台。
// 值不脱敏(提交前由测试人员 review),仅做长度截断。选择器/标签工具在 dom-meta.js。

(() => {
  if (window.__bugRecorderInstalled) return;
  window.__bugRecorderInstalled = true;

  const { truncate, textOf, fieldLabel, cssPath } = __bugrecMeta;
  const KEYBOARD_DEBOUNCE = 700;

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

  // 同步一轮 CustomEvent:设置标记 → 请求探针 → 接收结果
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
      if (p && p.catch) p.catch(() => {}); // 扩展重载后旧页面发送失败,静默
    } catch {
      /* Invalid extension context */
    }
  }

  /* 点击 */
  const INTERACTIVE =
    'a,button,input,select,textarea,label,[role="button"],[role="menuitem"],[role="tab"],summary,option';
  document.addEventListener(
    'click',
    (e) => {
      if (!(e.target instanceof Element)) return;
      const el = e.target.closest(INTERACTIVE) || e.target;
      const action = Object.assign({ kind: 'click' }, baseMeta(el));
      // 记录点击坐标(视口 CSS 像素),供截图标注点击位置
      action.point = { x: Math.round(e.clientX), y: Math.round(e.clientY) };
      action.viewport = { w: window.innerWidth, h: window.innerHeight };
      if (el.tagName === 'A' && el.href) action.href = el.href;
      const dv = clickValue(el);
      if (dv) Object.assign(action, dv);
      send(action);
    },
    true
  );

  function clickValue(el) {
    if (el.tagName === 'SELECT') {
      const opt = el.selectedOptions && el.selectedOptions[0];
      return { inputType: 'select', value: truncate(opt ? opt.textContent : el.value, 80) };
    }
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
      return { inputType: el.type, value: el.checked ? '选中' : '取消' };
    }
    if (el.tagName === 'TEXTAREA') return { inputType: 'textarea', value: truncate(el.value) };
    if (el.tagName === 'INPUT') {
      if (el.type === 'submit' || el.type === 'button' || el.type === 'image') return null;
      if (el.type === 'file') return { inputType: 'file', value: '[文件]' };
      return { inputType: el.type || 'text', value: truncate(el.value) };
    }
    return null;
  }

  /* 键盘输入(防抖合并)+ 回车/Esc 单独记一步 */
  const TEXT_INPUT =
    'input[type=text],input[type=search],input[type=number],input[type=email],input[type=url],input[type=tel],input[type=password],input:not([type]),textarea';
  const pending = new WeakMap();

  document.addEventListener(
    'input',
    (e) => {
      const el = e.target;
      if (!(el instanceof Element) || !el.matches(TEXT_INPUT)) return;
      clearTimeout(pending.get(el));
      pending.set(
        el,
        setTimeout(() => {
          pending.delete(el);
          send(Object.assign({ kind: 'input', inputType: 'keyboard', value: truncate(el.value) }, baseMeta(el)));
        }, KEYBOARD_DEBOUNCE)
      );
    },
    true
  );

  function flushPending(el) {
    const t = pending.get(el);
    if (!t) return;
    clearTimeout(t);
    pending.delete(el);
    send(Object.assign({ kind: 'input', inputType: 'keyboard', value: truncate(el.value) }, baseMeta(el)));
  }

  document.addEventListener(
    'keydown',
    (e) => {
      const el = e.target;
      if (!(el instanceof Element) || !el.matches('input,textarea')) return;
      if (e.key === 'Enter' || e.key === 'Escape') {
        flushPending(el);
        send(Object.assign({ kind: 'keypress', key: e.key }, baseMeta(el)));
      }
    },
    true
  );

  /* 下拉变化(change)——文本输入已由键盘防抖覆盖 */
  document.addEventListener(
    'change',
    (e) => {
      const el = e.target;
      if (!(el instanceof Element) || !el.matches('select')) return;
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

  /* 表单提交 */
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
        /* 复杂表单取值失败忽略 */
      }
      send(Object.assign({ kind: 'submit', value: truncate(fields.join('; '), 600) }, baseMeta(form)));
    },
    true
  );

  /* 主世界 Pinia 变更流 → 后台(按 ts 关联到步骤) */
  document.addEventListener('bugrec:pinia', (e) => {
    try {
      const p = chrome.runtime.sendMessage({ type: 'REC_PINIA', event: e.detail });
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* ignore */
    }
  });
})();
