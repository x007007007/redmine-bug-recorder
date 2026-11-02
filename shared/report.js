// 将一次录制会话生成 Redmine issue 的 Markdown 描述。
// 结构(按需求):
//   - URL 为"大步骤"(页面分组),组内的点击/键盘输入为"小步骤"
//   - 支持只包含测试人员勾选的步骤(selectedIds)
//   - 每个小步骤带 Vue 组件信息(组件名 / 链 / props 及与上次同组件的 diff)
//   - 每个小步骤带 Pinia 变化(快照变化 + $subscribe/$onAction 事件流按时间归组)
//   - API 请求按"最近一次小步骤之后"归组

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function describeAction(a) {
  switch (a.kind) {
    case 'navigate':
      return `打开页面 ${a.url}`;
    case 'click':
      return `点击「${a.label || a.selector || '元素'}」`;
    case 'input':
      if (a.inputType === 'keyboard') return `在「${a.label || a.selector || '输入框'}」中输入 ${JSON.stringify(a.value)}`;
      if (a.inputType === 'select') return `在「${a.label || a.selector || '下拉框'}」中选择 ${JSON.stringify(a.value)}`;
      if (a.inputType === 'checkbox' || a.inputType === 'radio')
        return `「${a.label || a.selector || ''}」${a.value === '选中' ? '勾选' : '取消勾选'}`;
      return `在「${a.label || a.selector || ''}」中输入 ${JSON.stringify(a.value)}`;
    case 'keypress':
      return `按下 ${a.key === 'Enter' ? '回车' : a.key} 键(焦点在「${a.label || a.selector || ''}」)`;
    case 'submit':
      return `提交表单「${a.label || a.selector || ''}」${a.value ? `(字段: ${a.value})` : ''}`;
    default:
      return `${a.kind} ${a.label || ''} @ ${a.url}`;
  }
}

/* ---------- 页面分组:URL 变化即新的大步骤 ---------- */

export function groupByPage(actions) {
  const groups = [];
  let cur = null;
  for (const a of actions) {
    if (!cur || a.url !== cur.url) {
      cur = { url: a.url, title: a.title || '', navigate: a.kind === 'navigate' ? a : null, steps: [] };
      groups.push(cur);
    } else if (a.kind === 'navigate' && !cur.navigate) {
      cur.navigate = a;
    }
    cur.steps.push(a);
  }
  return groups;
}

function shortUrl(url, max = 120) {
  try {
    const u = new URL(url);
    const s = u.pathname + (u.search || '');
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch {
    return String(url || '').slice(0, max);
  }
}

function clip(s, max) {
  s = String(s == null ? '' : s);
  return s.length > max ? s.slice(0, max) + `…(截断,共 ${s.length} 字符)` : s;
}

/* ---------- props diff:与上一次出现的同组件对比 ---------- */

function parseProps(json) {
  try {
    return typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return null;
  }
}

function diffProps(prevJson, curJson) {
  const prev = parseProps(prevJson);
  const cur = parseProps(curJson);
  if (!prev || !cur) return [];
  const changes = [];
  for (const k of Object.keys(cur)) {
    if (!(k in prev)) changes.push(`${k}: (新增) → ${cur[k]}`);
    else if (prev[k] !== cur[k]) changes.push(`${k}: ${prev[k]} → ${cur[k]}`);
  }
  return changes.slice(0, 8);
}

// 返回 Map<actionId, {prevJson, changes}>
export function computePropsDiffs(actions) {
  const lastByComp = new Map();
  const out = new Map();
  for (const a of actions) {
    const comp = a.vue && a.vue.component;
    if (!comp || !a.vue.props) continue;
    const prev = lastByComp.get(comp);
    const changes = prev ? diffProps(prev, a.vue.props) : [];
    out.set(a.id, { prevJson: prev, changes });
    lastByComp.set(comp, a.vue.props);
  }
  return out;
}

/* ---------- Pinia 变化的事件流按步骤归组 ---------- */

function groupEventsByStep(actions, events) {
  // events: [{ts, ...}] → [{stepIdx, items}];stepIdx 为 actions 下标,-1 表示首个选中步骤之前
  const groups = [];
  let curIdx = -2;
  let cur = null;
  for (const ev of events || []) {
    let idx = -1;
    for (let i = actions.length - 1; i >= 0; i--) {
      if (actions[i].ts <= ev.ts) {
        idx = i;
        break;
      }
    }
    if (idx !== curIdx) {
      if (cur) groups.push(cur);
      curIdx = idx;
      cur = { stepIdx: idx, items: [] };
    }
    cur.items.push(ev);
  }
  if (cur) groups.push(cur);
  return groups;
}

function describePiniaEvent(ev) {
  if (ev.action) {
    return `调用 \`${ev.storeId}.${ev.action}()\`${ev.args && ev.args !== '[]' ? ` 参数 ${ev.args}` : ''}`;
  }
  return `\`${ev.storeId}\` ${ev.changeType || '变更'}${ev.keys && ev.keys.length ? ` 字段 [${ev.keys.join(', ')}]` : ''}`;
}

function describePiniaSnapshot(ch) {
  return ch.firstSeen
    ? `Pinia store \`${ch.storeId}\` 首次捕获,状态: \`${clip(ch.state, 600)}\``
    : `Pinia store \`${ch.storeId}\` 状态变化,当前值: \`${clip(ch.state, 600)}\``;
}

/* ---------- API 请求归组 ---------- */

function groupRequestsByStep(actions, requests) {
  return groupEventsByStep(actions, requests);
}

const stepTitle = (actions, idx) => {
  if (idx < 0 || idx >= actions.length) return '所选步骤之前';
  const n = idx + 1;
  return `小步骤 ${n}(${describeAction(actions[idx])})之后`;
};

/* ---------- 汇总 ---------- */

export function buildDescription(session, actions, requests, logs, env, opts = {}) {
  const { piniaEvents = [], userAgent, lastUrl } = opts;
  const lines = [];
  const shotNames = new Map(); // action.id -> 附件文件名
  let shotNo = 0;
  for (const a of actions) {
    if (a.screenshot) {
      shotNo += 1;
      shotNames.set(a.id, `step-${String(shotNo).padStart(2, '0')}.jpg`);
    }
  }

  const propsDiffs = computePropsDiffs(actions);
  const pages = groupByPage(actions);

  lines.push('## 复现步骤');
  lines.push('');
  if (!actions.length) lines.push('(未记录到操作步骤)');
  pages.forEach((page, pi) => {
    const nav = page.navigate;
    const shot = nav && shotNames.get(nav.id);
    lines.push(`### 大步骤 ${pi + 1} · 页面 ${page.url}${page.title ? `(${page.title})` : ''}`);
    if (nav && shot) lines.push(`整页截图: ${shot}`);
    lines.push('');
    let stepNo = 0;
    page.steps.forEach((a) => {
      if (a.kind === 'navigate' && a === nav) return; // 已作为大步骤标题
      stepNo += 1;
      lines.push(`${stepNo}. ${describeAction(a)}`);
      if (a.selector) lines.push(`   - 元素: \`${clip(a.selector, 160)}\``);
      if (shotNames.has(a.id)) lines.push(`   - 截图: ${shotNames.get(a.id)}`);
      if (a.vue && a.vue.component) {
        const chain = a.vue.chain && a.vue.chain.length > 1 ? `(${a.vue.chain.join(' > ')})` : '';
        lines.push(`   - Vue 组件: ${a.vue.component}${chain}`);
        if (a.vue.props) lines.push(`   - 组件 props(点击时): \`${clip(a.vue.props, 600)}\``);
        const pd = propsDiffs.get(a.id);
        if (pd && pd.changes.length) {
          lines.push(`   - props 变化: ${pd.changes.map((c) => clip(c, 120)).join('; ')}`);
        }
      }
      if (a.vue && a.vue.piniaChanges && a.vue.piniaChanges.length) {
        for (const ch of a.vue.piniaChanges.filter((c) => !c.firstSeen)) {
          lines.push(`   - ${describePiniaSnapshot(ch)}`);
        }
      }
    });
    lines.push('');
  });

  lines.push('');
  lines.push('## 环境信息');
  lines.push('');
  lines.push(`- 记录时间: ${fmtTime(session.startedAt)}${session.endedAt ? ` ~ ${fmtTime(session.endedAt)}` : ''}`);
  if (userAgent) lines.push(`- User-Agent: ${userAgent}`);
  if (lastUrl) lines.push(`- 最后页面: ${lastUrl}`);

  const apiGroups = groupRequestsByStep(actions, requests);
  const piniaGroups = groupEventsByStep(actions, piniaEvents);
  if (apiGroups.length || piniaGroups.length) {
    lines.push('');
    lines.push('## 时序详情(按小步骤)');
    const allIdx = new Set([...apiGroups.map((g) => g.stepIdx), ...piniaGroups.map((g) => g.stepIdx)]);
    const sortedIdx = [...allIdx].sort((a, b) => a - b);
    for (const idx of sortedIdx) {
      lines.push('');
      lines.push(`**${stepTitle(actions, idx)}**`);
      const pg = piniaGroups.find((g) => g.stepIdx === idx);
      if (pg) {
        for (const ev of pg.items.slice(0, 10)) {
          lines.push(`- Pinia: ${describePiniaEvent(ev)}`);
        }
      }
      const rg = apiGroups.find((g) => g.stepIdx === idx);
      if (rg) {
        for (const req of rg.items) {
          const status = req.error ? `错误(${req.error})` : `**${req.status || '?'}**`;
          const dur = req.durationMs != null ? ` · ${req.durationMs}ms` : '';
          const flag = !req.error && req.status && req.status >= 400 ? ' ⚠️' : '';
          lines.push(`- API: \`${req.method} ${shortUrl(req.url)}\` → ${status}${dur}${flag}`);
          if (req.requestBody) lines.push(`  - 请求体: \`${clip(req.requestBody, 1024)}\``);
          if (req.responseBody !== undefined && req.responseBody !== null) {
            lines.push(`  - 响应体: \`${clip(req.responseBody, 2048)}\``);
          }
        }
      }
    }
  }

  const interestingLogs = (logs || [])
    .filter((l) => l.level === 'error' || l.level === 'warning')
    .slice(-50);
  if (interestingLogs.length) {
    lines.push('');
    lines.push('## Console 错误 / 警告(节选)');
    lines.push('');
    for (const l of interestingLogs) {
      lines.push(`- [${l.level}] ${clip(l.text, 300)}`);
    }
  }

  lines.push('');
  lines.push('> 本报告由 Bug Recorder for Redmine 自动生成,步骤与截图经测试人员勾选确认。');

  return lines.join('\n');
}

export function buildSubject(session, actions) {
  const first = actions.find((a) => a.kind !== 'navigate');
  const page = actions.length ? actions[actions.length - 1].url : '';
  let host = '';
  try {
    host = new URL(page).host;
  } catch {}
  const act = first ? describeAction(first) : '录制会话';
  return `[Bug Recorder] ${host ? host + ' ' : ''}${act} @ ${fmtTime(session.startedAt)}`;
}

export { fmtTime };
