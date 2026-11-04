// 修改意见窗口：扩展自己的弹出窗口，不插入被测页面。

import { send } from '../manager/api';
import { bootI18n, t } from '../shared/i18n';

bootI18n();
import { NOTE_DRAFT_KEY } from '../shared/types';
import type { NoteDraft } from '../shared/types';

const opinion = document.getElementById('opinion') as HTMLTextAreaElement;
const hint = document.getElementById('hint') as HTMLDivElement;
let draft: NoteDraft | null = null;
let isRecording = false;

function text(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function vueLabel(note: NoteDraft): string {
  const vue = note.vue;
  if (!vue || !vue.component) return t('noteNoVue');
  const chain = vue.chain && vue.chain.length > 1 ? ` (${vue.chain.join(' > ')})` : '';
  return vue.component + chain;
}

function show(note: NoteDraft): void {
  draft = note;
  const page = `${note.title ? note.title + ' · ' : ''}${note.url}`;
  text('pageText', page);
  text('elText', `${note.htmlHint} · ${note.selector}`);
  text('vueText', vueLabel(note));
  text('propsText', note.vue && note.vue.props ? note.vue.props : t('noteNoProps'));
  opinion.disabled = !isRecording;
  hint.textContent = isRecording ? '' : t('noteNeedRecording');
  if (isRecording) opinion.focus();
}

async function load(): Promise<void> {
  const state = await send({ type: 'GET_STATE' });
  isRecording = state.recording;
  const stored = await chrome.storage.session.get(NOTE_DRAFT_KEY);
  const note = stored[NOTE_DRAFT_KEY] as NoteDraft | undefined;
  if (!note || !note.url) {
    hint.textContent = t('noteNoElement');
    opinion.disabled = true;
    return;
  }
  show(note);
}

document.getElementById('btnCancel')?.addEventListener('click', () => window.close());
document.getElementById('btnSave')?.addEventListener('click', () => {
  void save();
});

async function save(): Promise<void> {
  if (!draft) return;
  const textValue = opinion.value.trim();
  if (!textValue) {
    hint.textContent = t('noteNeedText');
    return;
  }
  if (!isRecording) {
    hint.textContent = t('noteNeedRecording');
    return;
  }
  try {
    const res = await send({
      type: 'REC_NOTE',
      note: { ...draft, opinion: textValue.slice(0, 500), ts: Date.now() },
    });
    if (res.recorded) window.close();
    else hint.textContent = t('noteNotWritten');
  } catch (err) {
    hint.textContent = err instanceof Error ? err.message : t('noteWriteFailed');
  }
}

chrome.storage.session.onChanged.addListener((changes) => {
  const next = changes[NOTE_DRAFT_KEY];
  if (!next || !next.newValue) return;
  opinion.value = '';
  show(next.newValue as NoteDraft);
});

void load();
