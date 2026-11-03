// 提交范围:DevTools 时间轴选区(chrome.storage 一次性传递)
// 或默认范围(最近 100 步)。管理页按范围裁剪会话数据,可"查看全部"。

import { store, type ScopeInfo } from './store';
import { $ } from './dom';
import { fmtClock } from '../shared/describe';
import { t } from '../shared/i18n';
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
    label = t('scopeRange', [fmtClock(fromTs), fmtClock(toTs)]);
  } else {
    fromTs = full.actions[Math.max(0, full.actions.length - DEFAULT_MAX_ACTIONS)]!.ts;
    toTs = Infinity;
    label = t('scopeDefault', String(DEFAULT_MAX_ACTIONS));
  }
  const inRange = (ts: number): boolean => ts >= fromTs && ts <= toTs;
  return {
    cache: {
      session: full.session,
      actions: full.actions.filter((a) => inRange(a.ts)),
      requests: full.requests.filter((r) => inRange(r.ts)),
      logs: full.logs.filter((l) => inRange(l.ts)),
      pinia: full.pinia.filter((e) => inRange(e.ts)),
      notes: (full.notes || []).filter((n) => inRange(n.ts)),
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
  el.textContent = '';
  const label = document.createElement('b');
  label.textContent = store.scope.label;
  const full = document.createElement('a');
  full.href = '#';
  full.id = 'lnkFull';
  full.textContent = t('viewAll');
  const reset = document.createElement('a');
  reset.href = '#';
  reset.id = 'lnkDefault';
  reset.textContent = t('resetScope');
  el.append(document.createTextNode(t('scopePrefix')), label, document.createTextNode(' · '), full, document.createTextNode(' · '), reset);
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
