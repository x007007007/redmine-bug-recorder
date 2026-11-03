// 页面主世界:包装 console,把 log/info/warn/error 和未捕获异常发给隔离世界。
// Firefox 没有 chrome.debugger,不能靠 CDP 读 Console,所以在页面里挂钩。
// 载荷走 DOM 属性,避免 Firefox 读不到 CustomEvent.detail。

import { enqueue } from './bridge';

type Level = 'log' | 'info' | 'warning' | 'error';

function install(): void {
  const mark = window as unknown as { __bugrecConsole?: boolean };
  if (mark.__bugrecConsole) return;
  mark.__bugrecConsole = true;

  hook('log', 'log');
  hook('info', 'info');
  hook('warn', 'warning');
  hook('error', 'error');
  window.addEventListener('error', (ev) => {
    const text = ev.error instanceof Error ? ev.error.stack || ev.error.message : ev.message;
    emit('error', text || 'Script error');
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    const text = reason instanceof Error ? reason.stack || reason.message : formatArg(reason);
    emit('error', 'Unhandled rejection: ' + text);
  });
}

function hook(method: 'log' | 'info' | 'warn' | 'error', level: Level): void {
  const orig = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    emit(level, args.map(formatArg).join(' '));
    orig(...args);
  };
}

function emit(level: Level, text: string): void {
  const body = text.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!body) return;
  enqueue({ channel: 'console', level, text: body });
}

function formatArg(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

install();
