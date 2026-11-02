// 提交范围:DevTools 时间轴选区(chrome.storage.session 一次性传递)
// 或默认范围(最近 100 步)。管理页按范围裁剪会话数据,可"查看全部"。

import { store } from './store.js';
import { fmtClock } from '../shared/describe.js';

export const DEFAULT_MAX_ACTIONS = 100;

// 读取并清除一次性选区(仅当属于当前会话);storage.session 不可用时兜底 local
export async function readPendingRange(sessionId) {
  const areas = [chrome.storage.session, chrome.storage.local].filter(Boolean);
  for (const area of areas) {
    try {
      const { submitRange } = await area.get('submitRange');
      if (submitRange && submitRange.sessionId === sessionId) {
        await area.remove('submitRange');
        return submitRange; // { fromTs, toTs }
      }
    } catch {
      /* 尝试下一个区域 */
    }
  }
  return null;
}

// 按范围裁剪会话数据;无显式选区且步数超限时默认取最近 N 步
export function applyScope(fullCache, range, fullScope) {
  if (fullScope || (!range && fullCache.actions.length <= DEFAULT_MAX_ACTIONS)) {
    return { cache: fullCache, scope: null };
  }
  let fromTs;
  let toTs;
  let label;
  if (range) {
    fromTs = range.fromTs;
    toTs = range.toTs;
    label = `时间轴选区 ${fmtClock(fromTs)} ~ ${fmtClock(toTs)}`;
  } else {
    fromTs = fullCache.actions[Math.max(0, fullCache.actions.length - DEFAULT_MAX_ACTIONS)].ts;
    toTs = Infinity;
    label = `默认仅保留最近 ${DEFAULT_MAX_ACTIONS} 步`;
  }
  const inRange = (ts) => ts >= fromTs && ts <= toTs;
  return {
    cache: {
      session: fullCache.session,
      actions: fullCache.actions.filter((a) => inRange(a.ts)),
      requests: fullCache.requests.filter((r) => inRange(r.ts)),
      logs: fullCache.logs,
      pinia: fullCache.pinia.filter((e) => inRange(e.ts)),
    },
    scope: { fromTs, toTs, label },
  };
}

// 范围横幅:说明当前生效范围,提供"查看全部 / 恢复默认"
export function renderScopeBanner() {
  const el = document.getElementById('scopeInfo');
  if (!store.scope) {
    el.textContent = '';
    return;
  }
  el.innerHTML =
    `⚠️ 当前生效范围:<b>${store.scope.label}</b> · ` +
    `<a href="#" id="lnkFull">查看全部</a> · <a href="#" id="lnkDefault">恢复默认范围</a>`;
  document.getElementById('lnkFull').addEventListener('click', async (e) => {
    e.preventDefault();
    store.fullScope = true;
    refetch();
  });
  document.getElementById('lnkDefault').addEventListener('click', async (e) => {
    e.preventDefault();
    store.fullScope = false;
    refetch();
  });
}

async function refetch() {
  const { selectSession } = await import('./sessions-ui.js');
  selectSession(store.currentId);
}
