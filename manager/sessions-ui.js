// 会话列表:渲染 / 选择 / 删除。

import { send } from './api.js';
import { $, esc, showError } from './dom.js';
import { store } from './store.js';
import { fmtTime } from '../shared/describe.js';
import { renderAll } from './steps-ui.js';
import { prefillForm } from './report-ui.js';

export async function refreshSessions() {
  store.sessions = await send({ type: 'LIST_SESSIONS' });
  const box = $('sessions');
  box.textContent = '';
  for (const s of store.sessions) {
    box.appendChild(buildSessionItem(s));
  }
  if (!store.sessions.length) {
    box.innerHTML = '<div style="padding:16px;color:#80868b;font-size:12px;">暂无会话</div>';
  }
}

function buildSessionItem(s) {
  const div = document.createElement('div');
  div.className = 'session' + (s.id === store.currentId ? ' sel' : '');
  div.dataset.id = s.id;

  const t = document.createElement('div');
  t.className = 't';
  t.textContent = fmtTime(s.startedAt);

  const sub = document.createElement('div');
  sub.className = 's';
  const chip = document.createElement('span');
  const statusText = { recording: '录制中', stopped: '已停止', submitted: `已提交 #${s.issueId || ''}` }[s.status] || s.status;
  chip.className = `status-chip status-${s.status}`;
  chip.textContent = statusText;
  sub.append(
    chip,
    document.createTextNode(
      ` 步骤 ${s.actionCount} · API ${s.requestCount}${s.piniaCount ? ` · Pinia ${s.piniaCount}` : ''}`
    )
  );

  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = '✕';
  del.title = '删除会话';
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('确认删除该会话及其所有截图/记录?')) return;
    await send({ type: 'DELETE_SESSION', id: s.id });
    if (store.currentId === s.id) {
      store.currentId = null;
      store.cache = null;
      setDetailVisible(false);
      renderAll();
    }
    refreshSessions();
  });

  div.append(t, sub, del);
  div.addEventListener('click', () => selectSession(s.id));
  return div;
}

export async function selectSession(id) {
  store.currentId = id;
  store.subjectDirty = false;
  store.descDirty = false;
  $('submitResult').textContent = '';
  document.querySelectorAll('.session').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
  if (!id) return;
  try {
    store.cache = await send({ type: 'GET_SESSION', id });
  } catch (e) {
    store.cache = null;
    showError(e);
    return;
  }
  store.selected = new Set(store.cache.actions.map((a) => a.id)); // 默认全选,review 时可取消
  setDetailVisible(true);
  renderAll();
  prefillForm();
}

function setDetailVisible(has) {
  $('sessionDetail').hidden = !has;
  $('noSession').hidden = has;
}
