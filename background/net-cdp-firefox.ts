// Firefox 构建替换 net-cdp.ts：没有 chrome.debugger，Console 仍走页面挂钩。

export { recordPageConsole } from './page-console';

export async function attachDebugger(_tabId: number | null | undefined): Promise<void> {}

export async function refreshDebuggerAttachment(): Promise<void> {}

export function detachAll(): void {}

export function installNetCdp(): void {}
