// 管理页共享可变状态(各 UI 模块读写同一对象)。

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
  search: string;
  subjectDirty: boolean;
  descDirty: boolean;
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
  search: '',
  subjectDirty: false,
  descDirty: false,
};

export type { RecordedAction, SubmitRange };
