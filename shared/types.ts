// 核心数据模型与消息类型(全插件共用)。

import type { CaptureFlags } from './capture';

export interface ClickPoint {
  x: number;
  y: number;
}

export interface Viewport {
  w: number;
  h: number;
}

/** 主世界探针返回的 Vue 信息(扁平结构) */
export interface VueInfo {
  component: string | null;
  chain: string[];
  props: string | null;
  piniaChanges: PiniaChange[];
  error?: string;
}

export interface PiniaChange {
  storeId: string;
  state: string;
  firstSeen: boolean;
}

export type ActionKind = 'navigate' | 'click' | 'input' | 'keypress' | 'submit';

/** 一条 UI 操作步骤(落库后含自增 id 与截图 dataURL) */
export interface RecordedAction {
  id?: number;
  sessionId: string;
  kind: ActionKind;
  url: string;
  title?: string;
  ts: number;
  selector?: string;
  label?: string;
  value?: string;
  href?: string;
  inputType?: string;
  key?: string;
  vue?: VueInfo | null;
  point?: ClickPoint;
  viewport?: Viewport;
  screenshot?: string;
  tabId?: number | null;
  windowId?: number | null;
}

/** 一条 API 请求记录 */
export interface RequestEntry {
  id?: number;
  sessionId: string;
  ts: number;
  method: string;
  url: string;
  resourceType?: string;
  source?: 'webRequest' | 'CDP';
  requestBody?: string;
  status?: number;
  durationMs?: number | null;
  contentType?: string;
  error?: string;
  responseBody?: string | null;
}

/** Pinia 变更流事件($subscribe / $onAction) */
export interface PiniaEvent {
  id?: number;
  sessionId: string;
  ts: number;
  storeId: string;
  changeType?: string;
  keys?: string[];
  action?: string;
  args?: string;
}

export interface LogEntry {
  id?: number;
  sessionId: string;
  ts: number;
  level: 'log' | 'info' | 'warning' | 'error';
  text: string;
}

/** 右键记下的修改意见:只保留页面、元素定位、要改成什么 */
export interface ChangeNote {
  id?: number;
  sessionId: string;
  ts: number;
  url: string;
  title?: string;
  selector: string;
  label: string;
  htmlHint: string;
  vue?: VueInfo | null;
  opinion: string;
}

export type SessionStatus = 'recording' | 'stopped' | 'submitted';

/** 一次成功提交到 Redmine 的 issue 链接 */
export interface IssueLink {
  issueId: number;
  issueUrl: string;
  subject: string;
  submittedAt: number;
  /** 含首次创建。大于 1 表示后来又更新过这条 issue */
  revisionCount?: number;
}

export interface RecorderSession {
  id: string;
  startedAt: number;
  endedAt: number | null;
  status: SessionStatus;
  subject: string;
  issueId: number | null;
  issueUrl: string | null;
  /** 该会话历次提交,最新的在最后 */
  submissions?: IssueLink[];
}

export interface RecorderSettings {
  redmineUrl?: string;
  apiKey?: string;
  captureBodies?: boolean;
  capture?: Partial<CaptureFlags>;
  projectId?: string | number;
  trackerId?: string | number;
  priorityId?: string | number;
}

export interface StateInfo {
  recording: boolean;
  sessionId: string | null;
  debuggerFailed?: boolean;
  capture: CaptureFlags;
}

export interface SessionSummary extends RecorderSession {
  actionCount: number;
  requestCount: number;
  logCount: number;
  piniaCount: number;
}

export interface SessionDetail {
  session: RecorderSession;
  actions: RecordedAction[];
  requests: RequestEntry[];
  logs: LogEntry[];
  pinia: PiniaEvent[];
  notes: ChangeNote[];
}

/** 时间线条目:操作 / API / Pinia / Console 统一按 ts 交错 */
export type TimelineEntry =
  | { type: 'action'; ts: number; data: RecordedAction; ownerStepIdx: number }
  | { type: 'request'; ts: number; data: RequestEntry; ownerStepIdx: number }
  | { type: 'pinia'; ts: number; data: PiniaEvent; ownerStepIdx: number }
  | { type: 'log'; ts: number; data: LogEntry; ownerStepIdx: number }
  | { type: 'note'; ts: number; data: ChangeNote; ownerStepIdx: number };

/** 页面(大步骤)分组 */
export interface PageGroup {
  key: string;
  orderIndex: number;
  pseudo?: boolean;
  url: string;
  title: string;
  actions: RecordedAction[];
  entries: TimelineEntry[];
  startTime: number;
  endTime: number;
  startTs: number;
  tabId?: number | null;
}

export interface SubmitRange {
  sessionId: string;
  fromTs: number;
  toTs: number;
}

export interface SubmitResult {
  issueId: number | null;
  issueUrl: string | null;
  uploadCount: number;
  submissions: IssueLink[];
}

export interface RedmineUser {
  login: string;
  name: string;
}

/** popup/manager/devtools → SW 的消息类型 → 响应类型映射 */
export interface ResultMap {
  REC_ACTION: { recorded: boolean; id?: number };
  REC_PINIA: { recorded: boolean; capped?: boolean };
  REC_LOG: { recorded: boolean };
  REC_NOTE: { recorded: boolean };
  START_RECORDING: { ok: boolean; sessionId?: string; already?: boolean };
  STOP_RECORDING: { ok: boolean; sessionId?: string | null };
  GET_STATE: StateInfo;
  LIST_SESSIONS: SessionSummary[];
  GET_SESSION: SessionDetail;
  GET_SELECTION: { sessionId: string; ids: number[] | null };
  SET_SELECTION: { ok: true };
  DELETE_SESSION: { ok: true };
  DELETE_ITEMS: { ok: true; removed: number };
  SETTINGS_GET: RecorderSettings;
  SETTINGS_SET: { ok: true };
  SET_CAPTURE: CaptureFlags;
  TEST_REDMINE: RedmineUser;
  LIST_PROJECTS: { id: number; name: string; identifier?: string }[];
  LIST_TRACKERS: { id: number; name: string }[];
  LIST_PRIORITIES: { id: number; name: string }[];
  SUBMIT_REDMINE: SubmitResult;
}

export type MessageOf<M extends keyof ResultMap> = { type: M } & Record<string, unknown>;

export function errText(e: unknown): string {
  return String((e as { message?: string } | null)?.message ?? e);
}
