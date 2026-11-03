// Redmine issue 描述生成:按页面(大步骤)分组,页面内操作与 API/Pinia 事件按时间线交错。
// 描述始终按时间正序排列(复现步骤必须按先后),UI 中的排序/过滤只影响视图。

import { fmtTime, fmtClock, clip, shortUrl, describeAction, describeElement, describeLog, describePiniaEvent } from './describe';
import { t } from './i18n';
import { buildPages, computePropsDiffs } from './timeline';
import { planShotUploads } from './shots';
import type { ChangeNote, LogEntry, PiniaEvent, RecordedAction, RequestEntry, RecorderSession } from './types';

export interface ReportEnv {
  userAgent?: string;
  lastUrl?: string;
}

export interface ReportOpts {
  piniaEvents?: PiniaEvent[];
  shotLimit?: number;
  notes?: ChangeNote[];
}

export function buildDescription(
  session: RecorderSession,
  actions: RecordedAction[],
  requests: RequestEntry[],
  logs: LogEntry[],
  env: ReportEnv = {},
  opts: ReportOpts = {}
): string {
  const { piniaEvents = [], shotLimit = 0, notes = [] } = opts;
  const { userAgent, lastUrl } = env;
  const lines: string[] = [];
  const shots = new Map(planShotUploads(actions, shotLimit).map((p) => [p.actionId, p.filename]));
  const propsDiffs = computePropsDiffs(actions);
  const pages = buildPages(actions, requests, piniaEvents, logs);

  lines.push(t('reportSteps'));
  lines.push('');
  if (!actions.length) lines.push(t('reportNoSteps'));

  for (const p of pages) {
    if (p.pseudo) {
      lines.push(t('reportBefore', String(p.entries.length)));
      continue;
    }
    const nav = p.actions.find((a) => a.kind === 'navigate');
    const shot = nav ? shots.get(nav.id) : null;
    const time = fmtClock(p.startTime) + (p.endTime > p.startTime ? ` ~ ${fmtClock(p.endTime)}` : '');
    const title = p.title ? t('reportPageTitle', p.title) : '';
    lines.push(t('reportPage', [String(p.orderIndex), p.url, title, time]));
    if (shot) lines.push(t('reportFullShot', shot));
    lines.push('');

    let stepNo = 0;
    for (const e of p.entries.filter((x) => x.ownerStepIdx < 0 && x.type !== 'action')) {
      lines.push(`- ${entryLine(e)}`);
    }
    p.actions.forEach((a, idx) => {
      if (a.kind === 'navigate' && a === nav) return;
      stepNo += 1;
      lines.push(`${stepNo}. ${describeAction(a)}`);
      if (a.selector) lines.push(t('reportElement', clip(a.selector, 160)));
      if (a.id != null && shots.has(a.id)) lines.push(t('reportShot', shots.get(a.id) || ''));
      appendVueLines(lines, a, propsDiffs);
      for (const e of p.entries.filter((x) => x.ownerStepIdx === idx && x.type !== 'action')) {
        lines.push(t('reportChild', entryLine(e)));
        if (e.type === 'request') appendReqBody(lines, e.data);
      }
    });
    lines.push('');
  }

  lines.push('');
  lines.push(t('reportNotes'));
  lines.push('');
  appendNotes(lines, notes);

  lines.push('');
  lines.push(t('reportEnv'));
  lines.push('');
  const ended = session.endedAt ? ` ~ ${fmtTime(session.endedAt)}` : '';
  lines.push(t('reportTime', fmtTime(session.startedAt) + ended));
  if (userAgent) lines.push(`- User-Agent: ${userAgent}`);
  if (lastUrl) lines.push(t('reportLastUrl', lastUrl));

  appendConsole(lines, logs);
  lines.push('');
  lines.push(t('reportFooter'));
  return lines.join('\n');
}

function entryLine(e: { type: string; data: unknown }): string {
  if (e.type === 'request') {
    const r = e.data as RequestEntry;
    const status = r.error ? t('reportReqError', r.error) : `**${r.status || '?'}**`;
    const dur = r.durationMs != null ? ` · ${r.durationMs}ms` : '';
    const flag = !r.error && r.status && r.status >= 400 ? ' ⚠️' : '';
    return t('reportApi', [r.method, shortUrl(r.url), status, dur, flag]);
  }
  if (e.type === 'log') return describeLog(e.data as LogEntry);
  return `Pinia: ${describePiniaEvent(e.data as PiniaEvent)}`;
}

function appendReqBody(lines: string[], r: RequestEntry): void {
  if (r.requestBody) lines.push(t('reportReqBody', clip(r.requestBody, 1024)));
  if (r.responseBody !== undefined && r.responseBody !== null) {
    lines.push(t('reportResBody', clip(r.responseBody, 2048)));
  }
}

function appendVueLines(lines: string[], a: RecordedAction, propsDiffs: Map<number | undefined, { changes: string[] }>): void {
  if (!a.vue || !a.vue.component) return;
  const chain = a.vue.chain && a.vue.chain.length > 1 ? `(${a.vue.chain.join(' > ')})` : '';
  lines.push(t('reportVue', [a.vue.component, chain]));
  if (a.vue.props) lines.push(t('reportProps', clip(a.vue.props, 600)));
  const pd = propsDiffs.get(a.id);
  if (pd && pd.changes.length) {
    lines.push(t('reportPropsDiff', pd.changes.map((c) => clip(c, 120)).join('; ')));
  }
  if (a.vue.piniaChanges && a.vue.piniaChanges.length) {
    for (const ch of a.vue.piniaChanges.filter((c) => !c.firstSeen)) {
      lines.push(t('reportPinia', [ch.storeId, clip(ch.state, 600)]));
    }
  }
}

function appendNotes(lines: string[], notes: ChangeNote[]): void {
  if (!notes.length) {
    lines.push(t('reportNoNotes'));
    lines.push('');
    return;
  }
  const byUrl = new Map<string, ChangeNote[]>();
  for (const note of notes) {
    const list = byUrl.get(note.url) ?? [];
    list.push(note);
    byUrl.set(note.url, list);
  }
  for (const [url, list] of byUrl) {
    const title = list[0]?.title ? ` (${list[0].title})` : '';
    lines.push(`### ${url}${title}`);
    for (const note of list) {
      lines.push(t('reportNoteElement', describeElement(note)));
      lines.push(t('reportNoteChange', clip(note.opinion, 400)));
    }
    lines.push('');
  }
}

function appendConsole(lines: string[], logs: LogEntry[]): void {
  const interesting = (logs || []).filter((l) => l.level === 'error' || l.level === 'warning').slice(-50);
  if (!interesting.length) return;
  lines.push('');
  lines.push(t('reportConsole'));
  lines.push('');
  for (const l of interesting) lines.push(`- [${l.level}] ${clip(l.text, 300)}`);
}
