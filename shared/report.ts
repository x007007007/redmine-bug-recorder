// Redmine issue 描述生成:按页面(大步骤)分组,页面内操作与 API/Pinia 事件按时间线交错。
// 描述始终按时间正序排列(复现步骤必须按先后),UI 中的排序/过滤只影响视图。

import { fmtTime, fmtClock, clip, shortUrl, describeAction, describePiniaEvent } from './describe';
import { buildPages, computePropsDiffs } from './timeline';
import { planShotUploads } from './shots';
import type { LogEntry, PiniaEvent, RecordedAction, RequestEntry, RecorderSession } from './types';

export interface ReportEnv {
  userAgent?: string;
  lastUrl?: string;
}

export interface ReportOpts {
  piniaEvents?: PiniaEvent[];
  shotLimit?: number;
}

export function buildDescription(
  session: RecorderSession,
  actions: RecordedAction[],
  requests: RequestEntry[],
  logs: LogEntry[],
  env: ReportEnv = {},
  opts: ReportOpts = {}
): string {
  const { piniaEvents = [], shotLimit = 0 } = opts;
  const { userAgent, lastUrl } = env;
  const lines: string[] = [];
  const shots = new Map(planShotUploads(actions, shotLimit).map((p) => [p.actionId, p.filename]));
  const propsDiffs = computePropsDiffs(actions);
  const pages = buildPages(actions, requests, piniaEvents);

  lines.push('## 复现步骤');
  lines.push('');
  if (!actions.length) lines.push('(未记录到操作步骤)');

  for (const p of pages) {
    if (p.pseudo) {
      lines.push(`> 录制开始前的请求/事件 ${p.entries.length} 条,详见时序附录。`);
      continue;
    }
    const nav = p.actions.find((a) => a.kind === 'navigate');
    const shot = nav ? shots.get(nav.id) : null;
    const time = fmtClock(p.startTime) + (p.endTime > p.startTime ? ` ~ ${fmtClock(p.endTime)}` : '');
    lines.push(`### 大步骤 ${p.orderIndex} · 页面 ${p.url}${p.title ? `(${p.title})` : ''} · ${time}`);
    if (shot) lines.push(`整页截图: ${shot}`);
    lines.push('');

    let stepNo = 0;
    for (const e of p.entries.filter((x) => x.ownerStepIdx < 0 && x.type !== 'action')) {
      lines.push(`- ${entryLine(e)}`);
    }
    p.actions.forEach((a, idx) => {
      if (a.kind === 'navigate' && a === nav) return;
      stepNo += 1;
      lines.push(`${stepNo}. ${describeAction(a)}`);
      if (a.selector) lines.push(`   - 元素: \`${clip(a.selector, 160)}\``);
      if (a.id != null && shots.has(a.id)) lines.push(`   - 截图: ${shots.get(a.id)}`);
      appendVueLines(lines, a, propsDiffs);
      for (const e of p.entries.filter((x) => x.ownerStepIdx === idx && x.type !== 'action')) {
        lines.push(`   - ↳ ${entryLine(e)}`);
        if (e.type === 'request') appendReqBody(lines, e.data);
      }
    });
    lines.push('');
  }

  lines.push('');
  lines.push('## 环境信息');
  lines.push('');
  lines.push(`- 记录时间: ${fmtTime(session.startedAt)}${session.endedAt ? ` ~ ${fmtTime(session.endedAt)}` : ''}`);
  if (userAgent) lines.push(`- User-Agent: ${userAgent}`);
  if (lastUrl) lines.push(`- 最后页面: ${lastUrl}`);

  appendConsole(lines, logs);
  lines.push('');
  lines.push('> 本报告由 Bug Recorder for Redmine 自动生成,操作与 API 按时间线合并,步骤与截图经测试人员勾选确认。');
  return lines.join('\n');
}

function entryLine(e: { type: string; data: unknown }): string {
  if (e.type === 'request') {
    const r = e.data as RequestEntry;
    const status = r.error ? `错误(${r.error})` : `**${r.status || '?'}**`;
    const dur = r.durationMs != null ? ` · ${r.durationMs}ms` : '';
    const flag = !r.error && r.status && r.status >= 400 ? ' ⚠️' : '';
    return `API \`${r.method} ${shortUrl(r.url)}\` → ${status}${dur}${flag}`;
  }
  return `Pinia: ${describePiniaEvent(e.data as PiniaEvent)}`;
}

function appendReqBody(lines: string[], r: RequestEntry): void {
  if (r.requestBody) lines.push(`     - 请求体: \`${clip(r.requestBody, 1024)}\``);
  if (r.responseBody !== undefined && r.responseBody !== null) {
    lines.push(`     - 响应体: \`${clip(r.responseBody, 2048)}\``);
  }
}

function appendVueLines(lines: string[], a: RecordedAction, propsDiffs: Map<number | undefined, { changes: string[] }>): void {
  if (!a.vue || !a.vue.component) return;
  const chain = a.vue.chain && a.vue.chain.length > 1 ? `(${a.vue.chain.join(' > ')})` : '';
  lines.push(`   - Vue 组件: ${a.vue.component}${chain}`);
  if (a.vue.props) lines.push(`   - 组件 props(点击时): \`${clip(a.vue.props, 600)}\``);
  const pd = propsDiffs.get(a.id);
  if (pd && pd.changes.length) {
    lines.push(`   - props 变化: ${pd.changes.map((c) => clip(c, 120)).join('; ')}`);
  }
  if (a.vue.piniaChanges && a.vue.piniaChanges.length) {
    for (const ch of a.vue.piniaChanges.filter((c) => !c.firstSeen)) {
      lines.push(`   - Pinia store \`${ch.storeId}\` 状态变化,当前值: \`${clip(ch.state, 600)}\``);
    }
  }
}

function appendConsole(lines: string[], logs: LogEntry[]): void {
  const interesting = (logs || []).filter((l) => l.level === 'error' || l.level === 'warning').slice(-50);
  if (!interesting.length) return;
  lines.push('');
  lines.push('## Console 错误 / 警告(节选)');
  lines.push('');
  for (const l of interesting) lines.push(`- [${l.level}] ${clip(l.text, 300)}`);
}
