// 录制捕获开关:可在录制过程中随时打开或关闭,各入口共用同一份配置。

export interface CaptureFlags {
  isClickEnabled: boolean;
  isScreenshotEnabled: boolean;
  isKeyboardEnabled: boolean;
  isVueEnabled: boolean;
  isConsoleEnabled: boolean;
  isRequestEnabled: boolean;
  /** 为 true 时只记录当前标签页的请求;为 false 时记录所有标签页 */
  isRequestPageOnly: boolean;
}

export const DEFAULT_CAPTURE: CaptureFlags = {
  isClickEnabled: true,
  isScreenshotEnabled: true,
  isKeyboardEnabled: true,
  isVueEnabled: true,
  isConsoleEnabled: true,
  isRequestEnabled: true,
  isRequestPageOnly: true,
};

export const CAPTURE_TOGGLES: { key: keyof CaptureFlags; labelKey: string; titleKey: string }[] = [
  { key: 'isClickEnabled', labelKey: 'capClick', titleKey: 'capClickTitle' },
  { key: 'isScreenshotEnabled', labelKey: 'capShot', titleKey: 'capShotTitle' },
  { key: 'isKeyboardEnabled', labelKey: 'capKey', titleKey: 'capKeyTitle' },
  { key: 'isVueEnabled', labelKey: 'capVue', titleKey: 'capVueTitle' },
  { key: 'isConsoleEnabled', labelKey: 'capConsole', titleKey: 'capConsoleTitle' },
  { key: 'isRequestEnabled', labelKey: 'capRequest', titleKey: 'capRequestTitle' },
];

export interface RequestOrigin {
  tabId: number;
  url: string;
  initiator?: string;
  originUrl?: string;
  documentUrl?: string;
}

export function normalizeCapture(raw: Partial<CaptureFlags> | null | undefined): CaptureFlags {
  const out: CaptureFlags = { ...DEFAULT_CAPTURE };
  if (!raw) return out;
  for (const item of CAPTURE_TOGGLES) {
    const value = raw[item.key];
    if (typeof value === 'boolean') out[item.key] = value;
  }
  if (typeof raw.isRequestPageOnly === 'boolean') out.isRequestPageOnly = raw.isRequestPageOnly;
  return out;
}

function isExtensionOrigin(value: string | undefined): boolean {
  return !!value && /^(chrome-extension|moz-extension):/i.test(value);
}

/** 插件自己的请求,以及发往已配置 Redmine 的请求,都不记入会话。 */
export function shouldRecordRequest(
  details: RequestOrigin,
  isRequestPageOnly: boolean,
  activeTabId: number | null,
  redmineBase: string
): boolean {
  if (details.tabId < 0) return false;
  if (isExtensionOrigin(details.initiator) || isExtensionOrigin(details.originUrl) || isExtensionOrigin(details.documentUrl)) {
    return false;
  }
  if (redmineBase && (details.url === redmineBase || details.url.startsWith(`${redmineBase}/`))) return false;
  if (!isRequestPageOnly) return true;
  return activeTabId != null && details.tabId === activeTabId;
}
