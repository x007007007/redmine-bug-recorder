// 截图上传计划:管理页(描述命名)与 background(实际上传)共用同一份计划,
// 保证 step-NN 文件名完全一致。支持"最多附加 N 张(取最近的 N 张)"限量。

import type { RecordedAction } from './types';

export interface ShotPlanItem {
  actionId: number | undefined;
  filename: string;
  isPng: boolean;
}

/** 有点击坐标的截图用 PNG(烙入点击标记),其余保持 JPEG */
export function planShotUploads(actions: RecordedAction[], shotLimit = 0): ShotPlanItem[] {
  const withShots = actions.filter((a) => a.screenshot);
  const limited = shotLimit > 0 ? withShots.slice(-shotLimit) : withShots;
  return limited.map((a, i) => {
    const n = String(i + 1).padStart(2, '0');
    const isPng = !!(a.point && a.viewport);
    return { actionId: a.id, filename: `step-${n}.${isPng ? 'png' : 'jpg'}`, isPng };
  });
}
