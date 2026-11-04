// 提交目标的显示名。连接信息存在设置里,目前只有 Redmine 会真正创建 issue。

import { t } from './i18n';
import { ISSUE_PROVIDERS, type IssueProvider } from './types';

export function isIssueProvider(value: unknown): value is IssueProvider {
  return typeof value === 'string' && (ISSUE_PROVIDERS as readonly string[]).includes(value);
}

const LABEL_KEY: Record<IssueProvider, string> = {
  redmine: 'providerRedmine',
  jira: 'providerJira',
  feishu: 'providerFeishu',
  tapd: 'providerTapd',
  gitlab: 'providerGitlab',
  github: 'providerGithub',
  gitee: 'providerGitee',
};

export function providerLabel(provider: IssueProvider): string {
  return t(LABEL_KEY[provider]);
}
