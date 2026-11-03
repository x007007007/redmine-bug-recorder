// 文案与格式化工具:操作/事件的可读描述、时间格式、截断。

import { t } from './i18n';
import type { ChangeNote, LogEntry, PiniaEvent, RecordedAction, RecorderSession } from './types';

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function clip(s: unknown, max: number): string {
  const str = String(s == null ? '' : s);
  return str.length > max ? t('clip', [str.slice(0, max), String(str.length)]) : str;
}

export function shortUrl(url: string, max = 120): string {
  try {
    const u = new URL(url);
    const s = u.pathname + (u.search || '');
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch {
    return String(url || '').slice(0, max);
  }
}

export function describeAction(a: RecordedAction): string {
  switch (a.kind) {
    case 'navigate':
      return t('actionNavigate', a.url);
    case 'click':
      return t('actionClick', a.label || a.selector || t('labelElement'));
    case 'input':
      if (a.inputType === 'keyboard') return t('actionInput', [a.label || a.selector || t('labelInput'), JSON.stringify(a.value)]);
      if (a.inputType === 'select') return t('actionSelect', [a.label || a.selector || t('labelSelect'), JSON.stringify(a.value)]);
      if (a.inputType === 'checkbox' || a.inputType === 'radio') {
        const name = a.label || a.selector || '';
        return a.value === '选中' ? t('actionCheck', name) : t('actionUncheck', name);
      }
      return t('actionInput', [a.label || a.selector || '', JSON.stringify(a.value)]);
    case 'keypress':
      return t('actionKey', [a.key === 'Enter' ? t('keyEnter') : a.key || '', a.label || a.selector || '']);
    case 'submit':
      return t('actionSubmit', [a.label || a.selector || '', a.value ? t('actionFields', a.value) : '']);
    default:
      return t('actionFallback', [a.kind, a.label || '', a.url]);
  }
}

/** 元素定位:Vue 组件 + props + HTML 提示,给修改意见用 */
export function describeElement(note: ChangeNote): string {
  const bits: string[] = [];
  const vue = note.vue;
  if (vue && vue.component) {
    const chain = vue.chain && vue.chain.length > 1 ? ` (${vue.chain.join(' > ')})` : '';
    bits.push(`Vue ${vue.component}${chain}`);
  }
  if (vue && vue.props) bits.push(`props ${clip(vue.props, 180)}`);
  if (note.htmlHint) bits.push(note.htmlHint);
  if (note.selector) bits.push(note.selector);
  return bits.join(' · ') || t('elementUnknown');
}

export function describeNote(note: ChangeNote): string {
  return t('noteLine', [describeElement(note), note.opinion]);
}

export function describeLog(log: LogEntry): string {
  const label = { error: t('logError'), warning: t('logWarning'), info: t('logInfo'), log: t('logLog') }[log.level] ?? log.level;
  return t('consoleLine', [label, log.text]);
}

export function describePiniaEvent(ev: PiniaEvent): string {
  if (ev.action) {
    const args = ev.args && ev.args !== '[]' ? t('piniaArgs', ev.args) : '';
    return t('piniaCall', [ev.storeId, ev.action, args]);
  }
  const keys = ev.keys && ev.keys.length ? t('piniaKeys', ev.keys.join(', ')) : '';
  return t('piniaLine', [ev.storeId, ev.changeType || t('piniaChanged'), keys]);
}

export function buildSubject(session: RecorderSession, actions: RecordedAction[]): string {
  const first = actions.find((a) => a.kind !== 'navigate');
  const page = actions.length ? actions[actions.length - 1]!.url : '';
  let host = '';
  try {
    host = new URL(page).host;
  } catch {
    /* 无效 URL 忽略 */
  }
  const act = first ? describeAction(first) : t('subjectFallback');
  return `[Bug Recorder] ${host ? host + ' ' : ''}${act} @ ${fmtTime(session.startedAt)}`;
}
