// 设置区:Redmine 地址 / API Key / 捕获选项 / 连接测试 / 跟踪与优先级下拉。

import { send } from './api';
import { $, showError, fillSelect } from './dom';
import { store } from './store';
import type { RecorderSettings, RedmineUser } from '../shared/types';

export async function loadSettings(): Promise<void> {
  store.settings = await send({ type: 'SETTINGS_GET' });
  ($('setUrl') as HTMLInputElement).value = store.settings.redmineUrl || '';
  ($('setKey') as HTMLInputElement).value = store.settings.apiKey || '';
  ($('setBodies') as HTMLInputElement).checked = store.settings.captureBodies !== false;
}

function readSettingsInput(): RecorderSettings {
  return {
    ...store.settings,
    redmineUrl: ($('setUrl') as HTMLInputElement).value.trim(),
    apiKey: ($('setKey') as HTMLInputElement).value.trim(),
    captureBodies: ($('setBodies') as HTMLInputElement).checked,
  };
}

export function initSettings(): void {
  $('btnSaveSettings').addEventListener('click', onSave);
  $('btnTest').addEventListener('click', onTest);
  void loadTrackersAndPriorities();
}

async function onSave(): Promise<void> {
  store.settings = readSettingsInput();
  try {
    await send({ type: 'SETTINGS_SET', settings: store.settings });
    $('testResult').textContent = '✅ 已保存';
    window.setTimeout(() => ($('testResult').textContent = ''), 3000);
  } catch (e) {
    showError(e);
  }
}

async function onTest(): Promise<void> {
  $('testResult').textContent = '连接中…';
  try {
    const tmp: RecorderSettings = {
      redmineUrl: ($('setUrl') as HTMLInputElement).value.trim(),
      apiKey: ($('setKey') as HTMLInputElement).value.trim(),
    };
    const info: RedmineUser = await send({ type: 'TEST_REDMINE', settings: tmp });
    $('testResult').textContent = `✅ 连接成功:${info.login} (${info.name})`;
  } catch (e) {
    $('testResult').textContent = '';
    showError(e);
  }
}

export async function loadTrackersAndPriorities(): Promise<void> {
  try {
    const trackers = await send({ type: 'LIST_TRACKERS' });
    fillSelect($('bugTracker') as HTMLSelectElement, trackers, store.settings.trackerId);
    const prios = await send({ type: 'LIST_PRIORITIES' });
    fillSelect($('bugPriority') as HTMLSelectElement, prios, store.settings.priorityId);
  } catch {
    /* 非致命:保留"(默认)"选项 */
  }
}

export async function loadProjects(): Promise<void> {
  try {
    const projects = await send({ type: 'LIST_PROJECTS' });
    fillSelect($('bugProject') as HTMLSelectElement, projects, store.settings.projectId, '(请选择项目)');
    if (!projects.length) {
      showError(
        new Error(
          '项目列表为空:接口是通的(不是 404)。Redmine 只返回该账号可见的项目。请确认该账号至少是一个项目的成员;也可在下方手动填项目标识或数字 ID。'
        )
      );
    }
  } catch (e) {
    showError(e);
  }
}
