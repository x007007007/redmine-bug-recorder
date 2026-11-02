// 注册 DevTools 面板(类似 Vue Devtools 的做法)。
// 注意:Firefox 不支持 chrome.devtools 时静默跳过(其余功能不受影响)。
try {
  if (typeof chrome !== 'undefined' && chrome.devtools && chrome.devtools.panels) {
    chrome.devtools.panels.create('Bug Recorder', '/icons/icon32.png', '/devtools/panel.html');
  }
} catch {
  /* ignore */
}
