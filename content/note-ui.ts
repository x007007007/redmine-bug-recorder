// 右键「记录修改意见」:只记住被点中的元素。表单由后台打开扩展窗口，不插入页面。

import { cssPath, fieldLabel, textOf } from './dom-meta';
import type { NoteDraft, VueInfo } from '../shared/types';

export function installNoteCapture(readVue: (el: Element) => VueInfo | null): void {
  let draft: NoteDraft | null = null;

  document.addEventListener(
    'contextmenu',
    (ev) => {
      const el = ev.target;
      if (!(el instanceof Element)) return;
      draft = readDraft(el, readVue);
    },
    true
  );

  chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, sendResponse) => {
    if (!msg || msg.type !== 'TAKE_NOTE_DRAFT') return;
    sendResponse({ draft });
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
