// 录制器内容脚本(隔离世界):捕获点击 / 键盘输入(防抖) / 下拉 / 表单提交,
// 经 CustomEvent 向主世界探针请求 Vue/React/Pinia 信息后一并发给后台。
// 值不脱敏(提交前由测试人员 review),仅做长度截断。构建时打包为单个 IIFE 经典脚本。

import { t } from '../shared/i18n';
import { drainQueue, readVue } from './bridge';
import { truncate, textOf, fieldLabel, cssPath } from './dom-meta';
import { captureFlags, watchCaptureFlags } from './capture-flags';
import { installNoteCapture } from './note-ui';
import type { RecordedAction, FrameInfo } from '../shared/types';

function install(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w.__bugRecorderInstalled) return;
  w.__bugRecorderInstalled = true;
  watchCaptureFlags();

  const KEYBOARD_DEBOUNCE = 700;

  function baseMeta(el: Element | null) {
    return {
      url: location.href,
      title: document.title || '',
      ts: Date.now(),
      selector: el ? cssPath(el) : '',
      label: el ? fieldLabel(el) || textOf(el) : '',
      vue: captureFlags().isVueEnabled ? collectFrameInfo(el) : null,
    };
  }

  // 同步一轮 CustomEvent:清旧标记 → 打标 → 请求探针 → 接收结果
  let probeSeq = 0;
  function collectFrameInfo(el: Element | null): FrameInfo | null {
    if (!el || !el.setAttribute) return null;
    let info: FrameInfo | null = null;
    const onInfo = (): void => {
      info = readVue<FrameInfo>();
    };
    try {
      // 探针取"最后一个带标记的元素":先清掉历史标记,保证本次目标唯一
      for (const stale of document.querySelectorAll('[data-bugrec-eid]')) stale.removeAttribute('data-bugrec-eid');
      el.setAttribute('data-bugrec-eid', 'v' + ++probeSeq);
      document.addEventListener('bugrec:vue-info', onInfo, { once: true });
      document.dispatchEvent(new CustomEvent('bugrec:probe'));
      document.removeEventListener('bugrec:vue-info', onInfo);
      if (!info) info = readVue<FrameInfo>();
    } catch {
      /* 探针不可用时静默降级 */
    }
    return info;
  }

  function isOwnUi(ev: Event): boolean {
    const nodes = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
    for (const node of nodes) {
      if (!(node instanceof Element)) continue;
      if (node.id === 'bugrec-note-host' || node.id === 'bugrec-bridge') return true;
    }
    const target = ev.target;
    if (!(target instanceof Element)) return false;
    return target.id === 'bugrec-note-host' || target.id === 'bugrec-bridge' || !!target.closest('#bugrec-note-host, #bugrec-bridge');
  }

  function send(action: Partial<RecordedAction>): void {
    try {
      const p = chrome.runtime.sendMessage({ type: 'REC_ACTION', action });
      if (p && typeof (p as Promise<unknown>).catch === 'function') {
        (p as Promise<unknown>).catch(() => {}); // 扩展重载后旧页面发送失败,静默
      }
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
      if (!captureFlags().isClickEnabled || isOwnUi(e)) return;
      if (!(e.target instanceof Element)) return;
      const el = e.target.closest(INTERACTIVE) || e.target;
      const action: Partial<RecordedAction> = Object.assign({ kind: 'click' as const }, baseMeta(el));
      // 记录点击坐标(视口 CSS 像素),供截图标注点击位置
      action.point = { x: Math.round(e.clientX), y: Math.round(e.clientY) };
      action.viewport = { w: window.innerWidth, h: window.innerHeight };
      if (el instanceof HTMLAnchorElement && el.href) action.href = el.href;
      const dv = clickValue(el);
      if (dv) Object.assign(action, dv);
      send(action);
    },
    true
  );

  /* 点击到的控件值:select / checkbox / radio / file / 文本,提交按钮不算值 */
  function clickValue(el: Element): Partial<RecordedAction> | null {
    if (el instanceof HTMLSelectElement) return selectValue(el);
    if (el instanceof HTMLInputElement) return inputValue(el);
    if (el instanceof HTMLTextAreaElement) return { inputType: 'textarea', value: truncate(el.value) };
    return null;
  }

  function selectValue(el: HTMLSelectElement): Partial<RecordedAction> {
    const opt = el.selectedOptions && el.selectedOptions[0];
    return { inputType: 'select', value: truncate(opt ? opt.textContent : el.value, 80) };
  }

  function inputValue(el: HTMLInputElement): Partial<RecordedAction> | null {
    if (el.type === 'checkbox' || el.type === 'radio') return { inputType: el.type, value: el.checked ? '选中' : '取消' };
    if (el.type === 'submit' || el.type === 'button' || el.type === 'image') return null;
    if (el.type === 'file') return { inputType: 'file', value: t('fileValue') };
    return { inputType: el.type || 'text', value: truncate(el.value) };
  }

  /* 键盘输入(防抖合并)+ 回车/Esc 单独记一步 */
  const TEXT_INPUT =
    'input[type=text],input[type=search],input[type=number],input[type=email],input[type=url],input[type=tel],input[type=password],input:not([type]),textarea';
  const pending = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

  document.addEventListener(
    'input',
    (e) => {
      if (!captureFlags().isKeyboardEnabled || isOwnUi(e)) return;
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.matches(TEXT_INPUT)) return;
      const timer = pending.get(el);
      if (timer) clearTimeout(timer);
      pending.set(
        el,
        setTimeout(() => {
          pending.delete(el);
          recordKeyboard(el);
        }, KEYBOARD_DEBOUNCE)
      );
    },
    true
  );

  function recordKeyboard(el: HTMLElement): void {
    if (!captureFlags().isKeyboardEnabled) return;
    send(Object.assign({ kind: 'input' as const, inputType: 'keyboard', value: truncate((el as HTMLInputElement).value ?? '') }, baseMeta(el)));
  }

  function flushPending(el: HTMLElement): void {
    const timer = pending.get(el);
    if (!timer) return;
    clearTimeout(timer);
    pending.delete(el);
    recordKeyboard(el);
  }

  document.addEventListener(
    'keydown',
    (e) => {
      if (!captureFlags().isKeyboardEnabled || isOwnUi(e)) return;
      const el = e.target;
      if (!(el instanceof Element) || !el.matches('input,textarea')) return;
      if (e.key === 'Enter' || e.key === 'Escape') {
        flushPending(el as HTMLElement);
        send(Object.assign({ kind: 'keypress' as const, key: e.key }, baseMeta(el)));
      }
    },
    true
  );

  /* 下拉变化(change)——文本输入已由键盘防抖覆盖 */
  document.addEventListener(
    'change',
    (e) => {
      if (isOwnUi(e)) return;
      const el = e.target;
      if (!(el instanceof HTMLSelectElement)) return;
      send(Object.assign({ kind: 'input' as const, inputType: 'select' }, selectValue(el), baseMeta(el)));
    },
    true
  );

  /* 表单提交 */
  document.addEventListener(
    'submit',
    (e) => {
      if (isOwnUi(e)) return;
      const form = e.target;
      if (!(form instanceof Element)) return;
      send(Object.assign({ kind: 'submit' as const, value: truncate(formFields(form), 600) }, baseMeta(form)));
    },
    true
  );

  function formFields(form: Element): string {
    const fields: string[] = [];
    try {
      form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select').forEach((f) => {
        if (f.type === 'file') return;
        fields.push(`${fieldLabel(f) || cssPath(f)}=${truncate(f.value, 200)}`);
      });
    } catch {
      /* 复杂表单取值失败忽略 */
    }
    return fields.join('; ');
  }

  installNoteCapture((el) => (captureFlags().isVueEnabled ? collectFrameInfo(el) : null));

  /* 桥接队列:console / pinia 异步消息发后台 */
  type BridgeItem =
    | { channel: 'console'; level?: string; text?: string }
    | { channel: 'pinia'; event?: Record<string, unknown> };

  function postMessage(payload: Record<string, unknown>): void {
    try {
      const p = chrome.runtime.sendMessage(payload);
      if (p && typeof (p as Promise<unknown>).catch === 'function') (p as Promise<unknown>).catch(() => {});
    } catch {
      /* 扩展重载后旧页面发送失败 */
    }
  }

  function sendBridgeItem(item: BridgeItem): void {
    if (item.channel === 'console') {
      if (!captureFlags().isConsoleEnabled || !item.text) return;
      postMessage({ type: 'REC_LOG', level: item.level, text: item.text });
    } else if (item.channel === 'pinia') {
      if (!captureFlags().isVueEnabled || !item.event) return;
      postMessage({ type: 'REC_PINIA', event: item.event });
    }
  }

  const flushBridge = (): void => {
    for (const item of drainQueue<BridgeItem>()) sendBridgeItem(item);
  };
  document.addEventListener('bugrec:bridge', flushBridge);
  flushBridge();
}

install();
