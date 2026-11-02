// 文案与格式化工具:操作/事件的可读描述、时间格式、截断。

import type { PiniaEvent, RecordedAction, RecorderSession } from './types';

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
  return str.length > max ? str.slice(0, max) + `…(截断,共 ${str.length} 字符)` : str;
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
      return `打开页面 ${a.url}`;
    case 'click':
      return `点击「${a.label || a.selector || '元素'}」`;
    case 'input':
      if (a.inputType === 'keyboard') return `在「${a.label || a.selector || '输入框'}」中输入 ${JSON.stringify(a.value)}`;
      if (a.inputType === 'select') return `在「${a.label || a.selector || '下拉框'}」中选择 ${JSON.stringify(a.value)}`;
      if (a.inputType === 'checkbox' || a.inputType === 'radio')
        return `「${a.label || a.selector || ''}」${a.value === '选中' ? '勾选' : '取消勾选'}`;
      return `在「${a.label || a.selector || ''}」中输入 ${JSON.stringify(a.value)}`;
    case 'keypress':
      return `按下 ${a.key === 'Enter' ? '回车' : a.key} 键(焦点在「${a.label || a.selector || ''}」)`;
    case 'submit':
      return `提交表单「${a.label || a.selector || ''}」${a.value ? `(字段: ${a.value})` : ''}`;
    default:
      return `${a.kind} ${a.label || ''} @ ${a.url}`;
  }
}

export function describePiniaEvent(ev: PiniaEvent): string {
  if (ev.action) {
    return `调用 ${ev.storeId}.${ev.action}()${ev.args && ev.args !== '[]' ? ` 参数 ${ev.args}` : ''}`;
  }
  return `${ev.storeId} ${ev.changeType || '变更'}${ev.keys && ev.keys.length ? ` 字段 [${ev.keys.join(', ')}]` : ''}`;
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
  const act = first ? describeAction(first) : '录制会话';
  return `[Bug Recorder] ${host ? host + ' ' : ''}${act} @ ${fmtTime(session.startedAt)}`;
}
