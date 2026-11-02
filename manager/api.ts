// 后台消息调用封装(带类型映射)。

import type { MessageOf, ResultMap } from '../shared/types';

export async function send<M extends keyof ResultMap>(msg: MessageOf<M>): Promise<ResultMap[M]> {
  const res = (await chrome.runtime.sendMessage(msg)) as ResultMap[M] | { error?: string } | undefined;
  if (res && typeof res === 'object' && 'error' in res && res.error) throw new Error(String(res.error));
  return res as ResultMap[M];
}
