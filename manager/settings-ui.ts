// 提交页用到的设置读取,以及 Redmine 项目/跟踪/优先级下拉。连接表单在插件配置页。

import { send } from './api';
import { $, showError, fillSelect } from './dom';
import { store } from './store';
import { t } from '../shared/i18n';
import { orderedProjects } from '../shared/redmine';

export async function loadSettings(): Promise<void> {
  store.settings = await send({ type: 'SETTINGS_GET' });
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
    // 有层级的项目:父项目在前,子项目缩进展示(全角空格在 select 里不会被折叠)
    const rows = orderedProjects(projects);
    fillSelect(
      $('bugProject') as HTMLSelectElement,
      rows.map(({ project, depth }) => ({
        id: project.id,
        name: depth === 0 ? project.name : `${'　'.repeat(depth - 1)}└ ${project.name}`,
      })),
      store.settings.projectId,
      t('optPickProject')
    );
    if (!projects.length) showError(new Error(t('projectsEmpty')));
  } catch (e) {
    showError(e);
  }
}
