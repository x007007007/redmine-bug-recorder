// 录制捕获开关:可在录制过程中随时打开或关闭,各入口共用同一份配置。

export interface CaptureFlags {
  isClickEnabled: boolean;
  isScreenshotEnabled: boolean;
  isKeyboardEnabled: boolean;
  isVueEnabled: boolean;
  isConsoleEnabled: boolean;
  isRequestEnabled: boolean;
}

export const DEFAULT_CAPTURE: CaptureFlags = {
  isClickEnabled: true,
  isScreenshotEnabled: true,
  isKeyboardEnabled: true,
  isVueEnabled: true,
  isConsoleEnabled: true,
  isRequestEnabled: true,
};

export const CAPTURE_TOGGLES: { key: keyof CaptureFlags; label: string; title: string }[] = [
  { key: 'isClickEnabled', label: '点击', title: '记录点击事件' },
  { key: 'isScreenshotEnabled', label: '截图', title: '操作后截取可视区域' },
  { key: 'isKeyboardEnabled', label: '键盘', title: '记录键盘输入与回车' },
  { key: 'isVueEnabled', label: 'Vue', title: '记录组件状态与 Pinia' },
  { key: 'isConsoleEnabled', label: 'Console', title: '记录 console.log / info / warn / error 和未捕获异常' },
  { key: 'isRequestEnabled', label: '请求', title: '记录浏览器 XHR / Fetch' },
];

export function normalizeCapture(raw: Partial<CaptureFlags> | null | undefined): CaptureFlags {
  const out: CaptureFlags = { ...DEFAULT_CAPTURE };
  if (!raw) return out;
  for (const item of CAPTURE_TOGGLES) {
    const value = raw[item.key];
    if (typeof value === 'boolean') out[item.key] = value;
  }
  return out;
}
