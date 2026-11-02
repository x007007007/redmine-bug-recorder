const $ = (id) => document.getElementById(id);

function send(msg) {
  return chrome.runtime.sendMessage(msg).then((res) => {
    if (res && res.error) throw new Error(res.error);
    return res;
  });
}

function showError(e) {
  const el = $('err');
  el.hidden = false;
  el.textContent = String((e && e.message) || e);
}

async function refresh() {
  try {
    const st = await send({ type: 'GET_STATE' });
    $('dot').classList.toggle('on', st.recording);
    $('stateText').textContent = st.recording ? '录制中…' : '未录制';
    const btn = $('btnToggle');
    btn.textContent = st.recording ? '■ 停止录制' : '● 开始录制';
    btn.classList.toggle('stop', st.recording);

    const sessions = await send({ type: 'LIST_SESSIONS' });
    const cur = sessions.find((s) => s.id === st.sessionId) || sessions[0];
    if (cur) {
      const start = new Date(cur.startedAt).toLocaleTimeString('zh-CN', { hour12: false });
      $('stats').textContent = `${cur.status === 'recording' ? '当前会话' : '最近会话'} ${start} · 步骤 ${cur.actionCount} · API ${cur.requestCount}` +
        (cur.issueUrl ? ' · 已提交' : '');
    } else {
      $('stats').textContent = '还没有录制会话';
    }
    if (st.recording && st.debuggerFailed) {
      showError(new Error('调试器未能挂载(可能点了"取消"),本次仅记录请求元数据,不含响应体。'));
    }
  } catch (e) {
    showError(e);
  }
}

$('btnToggle').addEventListener('click', async () => {
  try {
    const st = await send({ type: 'GET_STATE' });
    await send({ type: st.recording ? 'STOP_RECORDING' : 'START_RECORDING' });
    refresh();
  } catch (e) {
    showError(e);
  }
});

$('btnManager').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('manager/manager.html') });
  window.close();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'SESSION_UPDATED') refresh();
});

refresh();
