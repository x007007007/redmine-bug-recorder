// 注册 DevTools 面板(类似 Vue Devtools 的做法)。
// Firefox 走 browser.devtools,Chrome 走 chrome.devtools;注册结果输出到日志,
// 在 about:debugging「检查」或浏览器控制台(Ctrl+Shift+J)可见,便于排障。
// 构建为 IIFE 经典脚本(devtools_page 要求)。

try {
  const api = ((typeof browser !== 'undefined' ? browser : chrome) as unknown as {
    devtools?: { panels?: { create: (title: string, icon: string, page: string) => void } };
  }).devtools;
  if (api && api.panels) {
    api.panels.create('Bug Recorder', 'icons/icon32.png', 'devtools/panel.html');
    console.log('[Bug Recorder] devtools panel registered');
  } else {
    console.warn('[Bug Recorder] devtools API 不可用,面板未注册(不影响录制/管理页功能)');
  }
} catch (e) {
  console.error('[Bug Recorder] devtools 面板注册失败:', e);
}
