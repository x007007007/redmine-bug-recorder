// 管理页共享可变状态(各 UI 模块读写同一对象)。

import { SHOW_ALL_CAPTURE, type CaptureView, type ListOrigin } from '../shared/timeline';
import type { RecordedAction, RecorderSettings, RecorderSession, SessionDetail, SubmitRange } from '../shared/types';

export interface ScopeInfo {
  fromTs: number;
  toTs: number;
  label: string;
}

export const store: {
  settings: RecorderSettings;
  sessions: (RecorderSession & { actionCount?: number })[];
  currentId: string | null;
  full: SessionDetail | null;
  cache: SessionDetail | null;
  scope: ScopeInfo | null;
  fullScope: boolean;
  selected: Set<number>;
  collapsed: Set<string>;
  sortMode: 'asc' | 'desc';
  listOrigin: ListOrigin;
  captureView: CaptureView;
  search: string;
  subjectDirty: boolean;
  descDirty: boolean;
  selectionRev: number;
} = {
  settings: {},
  sessions: [],
  currentId: null,
  full: null,
  cache: null,
  scope: null,
  fullScope: false,
  selected: new Set(),
  collapsed: new Set(),
  sortMode: 'desc',
  listOrigin: 'all',
  captureView: { ...SHOW_ALL_CAPTURE },
  search: '',
  subjectDirty: false,
  descDirty: false,
  selectionRev: 0,
};

export type { RecordedAction, SubmitRange };
