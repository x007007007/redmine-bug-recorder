// 右键「记录修改意见」:记住被点中的元素,弹出只关心页面 / 元素 / 改成什么的表单。

import { cssPath, fieldLabel, textOf, truncate } from './dom-meta';
import type { VueInfo } from '../shared/types';

export interface NoteDraft {
  url: string;
  title: string;
  selector: string;
  label: string;
  htmlHint: string;
  vue: VueInfo | null;
}

const HOST_ID = 'bugrec-note-host';

export function installNoteCapture(readVue: (el: Element) => VueInfo | null): void {
  let draft: NoteDraft | null = null;

  document.addEventListener(
    'contextmenu',
    (ev) => {
      const el = ev.target;
      if (!(el instanceof Element) || el.closest(`#${HOST_ID}`)) return;
      draft = readDraft(el, readVue);
    },
    true
  );

  chrome.runtime.onMessage.addListener((msg: { type?: string; isRecording?: boolean }, _sender, sendResponse) => {
    if (!msg || msg.type !== 'OPEN_NOTE') return;
    if (!draft) {
      sendResponse({ ok: false });
      return;
    }
    openForm(draft, msg.isRecording !== false);
    sendResponse({ ok: true });
  });
}

function readDraft(el: Element, readVue: (el: Element) => VueInfo | null): NoteDraft {
  const label = fieldLabel(el) || textOf(el);
  return {
    url: location.href,
    title: document.title || '',
    selector: cssPath(el),
    label,
    htmlHint: htmlHint(el, label),
    vue: readVue(el),
  };
}

function htmlHint(el: Element, label: string): string {
  const bits = [el.tagName.toLowerCase()];
  if (el.id) bits.push('#' + el.id);
  const testid = el instanceof HTMLElement ? el.dataset.testid : '';
  if (testid) bits.push(`[data-testid="${testid}"]`);
  if (label) bits.push(`「${label}」`);
  return bits.join('');
}

function openForm(draft: NoteDraft, isRecording: boolean): void {
  document.getElementById(HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;inset:0;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = formHtml(draft, isRecording);
  document.documentElement.appendChild(host);

  const box = root.querySelector('.card') as HTMLElement;
  const input = root.querySelector('textarea') as HTMLTextAreaElement;
  const hint = root.querySelector('.hint') as HTMLElement;
  const close = (): void => host.remove();
  root.querySelector('[data-act="cancel"]')?.addEventListener('click', close);
  root.querySelector('.mask')?.addEventListener('click', (ev) => {
    if (ev.target === root.querySelector('.mask')) close();
  });
  root.querySelector('[data-act="save"]')?.addEventListener('click', () => {
    const opinion = input.value.trim();
    if (!opinion) {
      hint.textContent = '请填写要改成什么';
      return;
    }
    if (!isRecording) {
      hint.textContent = '请先开始录制,意见会记在当前会话里';
      return;
    }
    saveNote(draft, opinion, hint, close);
  });
  input.focus();
  box.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') close();
  });
}

function saveNote(draft: NoteDraft, opinion: string, hint: HTMLElement, close: () => void): void {
  const note = { ...draft, opinion: truncate(opinion, 500), ts: Date.now() };
  try {
    const p = chrome.runtime.sendMessage({ type: 'REC_NOTE', note });
    void Promise.resolve(p)
      .then((res: { recorded?: boolean; error?: string } | undefined) => {
        if (res && res.recorded) close();
        else hint.textContent = res && res.error ? res.error : '没有写入(可能尚未开始录制)';
      })
      .catch(() => {
        hint.textContent = '写入失败';
      });
  } catch {
    hint.textContent = '写入失败';
  }
}

function formHtml(draft: NoteDraft, isRecording: boolean): string {
  const vue = draft.vue;
  const comp = vue && vue.component ? `${vue.component}${vue.chain && vue.chain.length > 1 ? ' (' + vue.chain.join(' > ') + ')' : ''}` : '未识别到 Vue 组件';
  const props = vue && vue.props ? vue.props : '(无 props)';
  return `
    <style>
      :host { all: initial; }
      .mask { position: fixed; inset: 0; background: rgba(32,33,36,.35); display: flex; align-items: center; justify-content: center; font: 13px/1.5 system-ui, sans-serif; color: #202124; }
      .card { width: min(440px, calc(100vw - 32px)); background: #fff; border-radius: 12px; padding: 14px 16px; box-shadow: 0 12px 40px rgba(0,0,0,.2); }
      h2 { margin: 0 0 8px; font-size: 15px; }
      .loc { margin: 0 0 8px; color: #3c4043; font-size: 12px; word-break: break-all; }
      .loc b { color: #5f6368; font-weight: 600; }
      textarea { width: 100%; box-sizing: border-box; min-height: 72px; border: 1px solid #dadce0; border-radius: 8px; padding: 8px; font: inherit; }
      .row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
      button { border: 1px solid #dadce0; background: #fff; border-radius: 8px; padding: 6px 12px; cursor: pointer; }
      button.primary { background: #d93025; color: #fff; border-color: #d93025; }
      .hint { color: #d93025; font-size: 12px; min-height: 1.2em; }
    </style>
    <div class="mask"><div class="card">
      <h2>记录修改意见</h2>
      <p class="loc"><b>页面</b> ${esc(draft.title ? draft.title + ' · ' : '')}${esc(draft.url)}</p>
      <p class="loc"><b>元素</b> ${esc(draft.htmlHint)} · ${esc(draft.selector)}</p>
      <p class="loc"><b>Vue</b> ${esc(comp)}</p>
      <p class="loc"><b>props</b> ${esc(props)}</p>
      <textarea placeholder="要改成什么" ${isRecording ? '' : 'disabled'}></textarea>
      <div class="hint">${isRecording ? '' : '请先开始录制,意见会记在当前会话里'}</div>
      <div class="row">
        <button type="button" data-act="cancel">取消</button>
        <button type="button" class="primary" data-act="save">保存</button>
      </div>
    </div></div>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
