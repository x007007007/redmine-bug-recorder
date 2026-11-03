// 内容脚本侧的捕获开关缓存。后台写入 storage 后这里立即生效,避免每次事件再问一次后台。

import { normalizeCapture, type CaptureFlags } from '../shared/capture';

const cache: { flags: CaptureFlags } = { flags: normalizeCapture(undefined) };

export function captureFlags(): CaptureFlags {
  return cache.flags;
}

export function watchCaptureFlags(): void {
  const apply = (raw: unknown): void => {
    const settings = raw as { capture?: Partial<CaptureFlags> } | undefined;
    cache.flags = normalizeCapture(settings?.capture);
  };
  try {
    chrome.storage.local.get('recorderSettings', (stored) => {
      const bag = stored as { recorderSettings?: { capture?: Partial<CaptureFlags> } };
      apply(bag.recorderSettings);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.recorderSettings) return;
      apply(changes.recorderSettings.newValue);
    });
  } catch {
    /* 扩展重载后旧页面读不到 storage,保持默认全开 */
  }
}
