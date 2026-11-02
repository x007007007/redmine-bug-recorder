// 面板共享状态(各视图模块读写同一对象)。

import type { PageGroup, SessionDetail, SessionSummary, SubmitRange } from '../shared/types';

export interface PanelState {
  recording: boolean;
  sessionId: string | null; // 正在查看的会话(默认=录制中的会话)
  activeId: string | null; // 正在录制的会话
  cache: SessionDetail | null;
  sessions: SessionSummary[];
  selected: Set<number>; // 勾选要提交的 action id(与提交页共享)
  pages: PageGroup[];
  pageIdx: number;
  highlightKey: string | null;
  rangeMode: boolean;
  rangeFromTs: number | null;
  range: SubmitRange | null;
}

export const panelState: PanelState = {
  recording: false,
  sessionId: null,
  activeId: null,
  cache: null,
  sessions: [],
  selected: new Set(),
  pages: [],
  pageIdx: 0,
  highlightKey: null,
  rangeMode: false,
  rangeFromTs: null,
  range: null,
};

export const selectionKey = (sessionId: string): string => `selection:${sessionId}`;
