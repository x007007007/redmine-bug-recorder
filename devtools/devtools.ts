// 注册 DevTools 面板(类似 Vue Devtools 的做法)。
// 注意:Firefox 不支持 chrome.devtools 时静默跳过(其余功能不受影响)。
// 构建为 IIFE 经典脚本(devtools_page 要求)。

try {
  const c = chrome as unknown as { devtools?: { panels?: { create: (t: string, i: string, p: string) => void } } };
  if (typeof chrome !== 'undefined' && c.devtools && c.devtools.panels) {
    c.devtools.panels.create('Bug Recorder', 'icons/icon32.png', 'devtools/panel.html');
  }
} catch {
  /* ignore */
}
