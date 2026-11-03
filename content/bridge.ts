// 主世界 ↔ 隔离世界的字符串通道。Firefox 下 CustomEvent.detail 跨隔离世界不可读,
// DOM 属性是字符串,两边都能读写。

const HOST_ID = 'bugrec-bridge';
const MAX_LINES = 200;

export function bridgeHost(): HTMLElement {
  const found = document.getElementById(HOST_ID);
  if (found) return found;
  const el = document.createElement('div');
  el.id = HOST_ID;
  el.setAttribute('hidden', '');
  el.style.display = 'none';
  (document.documentElement || document.head || document.body).appendChild(el);
  return el;
}

export function publishVue(payload: unknown): void {
  bridgeHost().setAttribute('data-vue', JSON.stringify(payload));
}

export function readVue<T>(): T | null {
  const raw = bridgeHost().getAttribute('data-vue');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 追加一条异步消息(console / pinia),并通知隔离世界来取 */
export function enqueue(payload: unknown): void {
  const host = bridgeHost();
  const line = JSON.stringify(payload);
  const prev = host.getAttribute('data-queue') || '';
  const lines = prev ? prev.split('\n') : [];
  lines.push(line);
  host.setAttribute('data-queue', lines.slice(-MAX_LINES).join('\n'));
  document.dispatchEvent(new Event('bugrec:bridge'));
}

export function drainQueue<T>(): T[] {
  const host = bridgeHost();
  const raw = host.getAttribute('data-queue') || '';
  if (!raw) return [];
  host.setAttribute('data-queue', '');
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      /* 坏行跳过 */
    }
  }
  return out;
}
