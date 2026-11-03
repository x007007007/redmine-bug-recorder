// 录制旁的捕获开关:点击 / 截图 / 键盘 / Vue / Console / 请求,随时改、各页面同步。

import { send } from './api';
import { CAPTURE_TOGGLES, normalizeCapture, type CaptureFlags } from '../shared/capture';
import { t } from '../shared/i18n';

export function bindCaptureToggles(bar: HTMLElement): void {
  if (bar.dataset.bound === '1') return;
  bar.dataset.bound = '1';
  mountCaptureToggles(bar);
  bar.addEventListener('change', (ev) => void onToggle(ev));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.recorderSettings) return;
    const next = changes.recorderSettings.newValue as { capture?: Partial<CaptureFlags> } | undefined;
    paintCaptureToggles(bar, normalizeCapture(next?.capture));
  });
  void send({ type: 'GET_STATE' })
    .then((st) => paintCaptureToggles(bar, st.capture))
    .catch(() => {});
}

function mountCaptureToggles(bar: HTMLElement): void {
  bar.textContent = '';
  const label = document.createElement('span');
  label.className = 'cap-label';
  label.textContent = t('capLabel');
  bar.appendChild(label);
  for (const item of CAPTURE_TOGGLES) {
    const lab = document.createElement('label');
    lab.className = 'chk';
    lab.title = t(item.titleKey);
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.cap = item.key;
    input.checked = true;
    lab.append(input, document.createTextNode(' ' + t(item.labelKey)));
    bar.appendChild(lab);
  }
  bar.appendChild(buildScopeSelect());
}

function buildScopeSelect(): HTMLLabelElement {
  const lab = document.createElement('label');
  lab.className = 'chk';
  lab.title = t('capScopeTitle');
  const select = document.createElement('select');
  select.dataset.capScope = '1';
  const page = document.createElement('option');
  page.value = 'page';
  page.textContent = t('capPage');
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = t('capAll');
  select.append(page, all);
  lab.append(document.createTextNode(t('capScope')), select);
  return lab;
}

function paintCaptureToggles(bar: HTMLElement, flags: CaptureFlags): void {
  for (const input of bar.querySelectorAll<HTMLInputElement>('input[data-cap]')) {
    const key = input.dataset.cap as keyof CaptureFlags;
    input.checked = !!flags[key];
  }
  const scope = bar.querySelector<HTMLSelectElement>('select[data-cap-scope]');
  if (scope) scope.value = flags.isRequestPageOnly ? 'page' : 'all';
}

async function onToggle(ev: Event): Promise<void> {
  const input = ev.target;
  if (input instanceof HTMLSelectElement && input.dataset.capScope) {
    const isRequestPageOnly = input.value !== 'all';
    try {
      await send({ type: 'SET_CAPTURE', capture: { isRequestPageOnly } });
    } catch {
      input.value = isRequestPageOnly ? 'all' : 'page';
    }
    return;
  }
  if (!(input instanceof HTMLInputElement) || !input.dataset.cap) return;
  const key = input.dataset.cap as keyof CaptureFlags;
  try {
    await send({ type: 'SET_CAPTURE', capture: { [key]: input.checked } });
  } catch {
    input.checked = !input.checked;
  }
}
