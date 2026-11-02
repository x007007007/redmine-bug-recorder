// 设置区:Redmine 地址 / API Key / 捕获选项 / 连接测试 / 跟踪与优先级下拉。

import { send } from './api.js';
import { $, showError, fillSelect } from './dom.js';
import { store } from './store.js';

export async function loadSettings() {
  store.settings = await send({ type: 'SETTINGS_GET' });
  $('setUrl').value = store.settings.redmineUrl || '';
  $('setKey').value = store.settings.apiKey || '';
  $('setBodies').checked = store.settings.captureBodies !== false;
}

export function init() {
  $('btnSaveSettings').addEventListener('click', onSave);
  $('btnTest').addEventListener('click', onTest);
  loadTrackersAndPriorities();
}

async function onSave() {
  store.settings = {
    ...store.settings,
    redmineUrl: $('setUrl').value.trim(),
    apiKey: $('setKey').value.trim(),
    captureBodies: $('setBodies').checked,
  };
  try {
    await send({ type: 'SETTINGS_SET', settings: store.settings });
    $('testResult').textContent = '✅ 已保存';
    setTimeout(() => ($('testResult').textContent = ''), 3000);
  } catch (e) {
    showError(e);
  }
}

async function onTest() {
  $('testResult').textContent = '连接中…';
  try {
    const tmp = { redmineUrl: $('setUrl').value.trim(), apiKey: $('setKey').value.trim() };
    const info = await send({ type: 'TEST_REDMINE', settings: tmp });
    $('testResult').textContent = `✅ 连接成功:${info.login} (${info.name})`;
  } catch (e) {
    $('testResult').textContent = '';
    showError(e);
  }
}

export async function loadTrackersAndPriorities() {
  try {
    const trackers = await send({ type: 'LIST_TRACKERS' });
    fillSelect($('bugTracker'), trackers, store.settings.trackerId);
    const prios = await send({ type: 'LIST_PRIORITIES' });
    fillSelect($('bugPriority'), prios, store.settings.priorityId);
  } catch {
    /* 非致命:保留"(默认)"选项 */
  }
}

export async function loadProjects() {
  try {
    const projects = await send({ type: 'LIST_PROJECTS' });
    fillSelect($('bugProject'), projects, store.settings.projectId, '(请选择项目)');
    if (!projects.length) showError(new Error('项目列表为空:请确认 API Key 所属账号有项目权限'));
  } catch (e) {
    showError(e);
  }
}
