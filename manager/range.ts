// 提交范围:DevTools 时间轴选区(chrome.storage 一次性传递)
// 或默认范围(最近 100 步)。管理页按范围裁剪会话数据,可"查看全部"。

import { store, type ScopeInfo } from './store';
import { $ } from './dom';
import { fmtClock } from '../shared/describe';
import type { SessionDetail, SubmitRange } from '../shared/types';

export const DEFAULT_MAX_ACTIONS = 100;

function storageAreas(): chrome.storage.StorageArea[] {
  return [chrome.storage.session, chrome.storage.local].filter(Boolean);
}

/** 读取并清除一次性选区(仅当属于当前会话);storage.session 不可用时兜底 local */
export async function readPendingRange(sessionId: string): Promise<SubmitRange | null> {
  for (const area of storageAreas()) {
    try {
      const { submitRange } = (await area.get('submitRange')) as { submitRange?: SubmitRange };
      if (submitRange && submitRange.sessionId === sessionId) {
        await area.remove('submitRange');
        return submitRange;
      }
    } catch {
      /* 尝试下一个区域 */
    }
  }
  return null;
}

/** 按范围裁剪会话数据;无显式选区且步数超限时默认取最近 N 步 */
export function applyScope(
  full: SessionDetail,
  range: SubmitRange | null,
  fullScope: boolean
): { cache: SessionDetail; scope: ScopeInfo | null } {
  if (fullScope || (!range && full.actions.length <= DEFAULT_MAX_ACTIONS)) {
    return { cache: full, scope: null };
  }
  let fromTs: number;
  let toTs: number;
  let label: string;
  if (range) {
    fromTs = range.fromTs;
    toTs = range.toTs;
    label = `时间轴选区 ${fmtClock(fromTs)} ~ ${fmtClock(toTs)}`;
  } else {
    fromTs = full.actions[Math.max(0, full.actions.length - DEFAULT_MAX_ACTIONS)]!.ts;
    toTs = Infinity;
    label = `默认仅保留最近 ${DEFAULT_MAX_ACTIONS} 步`;
  }
  const inRange = (ts: number): boolean => ts >= fromTs && ts <= toTs;
  return {
    cache: {
      session: full.session,
      actions: full.actions.filter((a) => inRange(a.ts)),
      requests: full.requests.filter((r) => inRange(r.ts)),
      logs: full.logs,
      pinia: full.pinia.filter((e) => inRange(e.ts)),
    },
    scope: { fromTs, toTs, label },
  };
}

/** 范围横幅:说明当前生效范围,提供"查看全部 / 恢复默认" */
export function renderScopeBanner(): void {
  const el = $('scopeInfo');
  if (!store.scope) {
    el.textContent = '';
    return;
  }
  el.innerHTML =
    `⚠️ 当前生效范围:<b>${store.scope.label}</b> · ` +
    `<a href="#" id="lnkFull">查看全部</a> · <a href="#" id="lnkDefault">恢复默认范围</a>`;
  document.getElementById('lnkFull')!.addEventListener('click', async (e) => {
    e.preventDefault();
    store.fullScope = true;
    await refetch();
  });
  document.getElementById('lnkDefault')!.addEventListener('click', async (e) => {
    e.preventDefault();
    store.fullScope = false;
    await refetch();
  });
}

async function refetch(): Promise<void> {
  const { selectSession } = await import('./sessions-ui');
  if (store.currentId) await selectSession(store.currentId);
}
