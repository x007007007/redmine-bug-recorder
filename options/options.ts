// 插件配置:语言、提交平台的连接信息。录制历史和提交在管理页。

import { send } from '../manager/api';
import { $, showError, showVersion } from '../manager/dom';
import { bootI18n, currentLocale, isLocalePref, t, useLocale } from '../shared/i18n';
import { isIssueProvider } from '../shared/tracker';
import type { IssueProvider, RecorderSettings, TrackerAccount } from '../shared/types';

bootI18n();

const URL_PLACEHOLDER: Record<IssueProvider, string> = {
  redmine: 'phUrl',
  jira: 'phUrlJira',
  feishu: 'phUrlFeishu',
  tapd: 'phUrlTapd',
  gitlab: 'phUrlGitlab',
  github: 'phUrlGithub',
  gitee: 'phUrlGitee',
};

let settings: RecorderSettings = {};
let provider: IssueProvider = 'redmine';
const drafts: Partial<Record<IssueProvider, TrackerAccount>> = {};

function accountOf(name: IssueProvider): TrackerAccount {
  if (drafts[name]) return drafts[name]!;
  const saved = settings.trackers?.[name];
  if (saved) return saved;
  if (name === 'redmine') return { baseUrl: settings.redmineUrl, token: settings.apiKey };
  return {};
}

function readAccount(): TrackerAccount {
  return {
    baseUrl: ($('setUrl') as HTMLInputElement).value.trim(),
    token: ($('setKey') as HTMLInputElement).value.trim(),
    account: ($('setAccount') as HTMLInputElement).value.trim(),
    project: ($('setProject') as HTMLInputElement).value.trim(),
  };
}

function paint(name: IssueProvider): void {
  const account = accountOf(name);
  const isRedmine = name === 'redmine';
  ($('setUrl') as HTMLInputElement).value = account.baseUrl || '';
  ($('setUrl') as HTMLInputElement).placeholder = t(URL_PLACEHOLDER[name]);
  ($('setKey') as HTMLInputElement).value = account.token || '';
  ($('setAccount') as HTMLInputElement).value = account.account || '';
  ($('setProject') as HTMLInputElement).value = account.project || '';
  $('labAccount').hidden = isRedmine;
  $('labProject').hidden = isRedmine;
  $('btnTest').hidden = !isRedmine;
  $('labKeyText').textContent = isRedmine ? t('labelKey') : t('labelToken');
  ($('setProvider') as HTMLSelectElement).value = name;
}

function readForm(): RecorderSettings {
  const localeValue = ($('setLocale') as HTMLSelectElement).value;
  const locale = isLocalePref(localeValue) ? localeValue : 'auto';
  const account = readAccount();
  const trackers = { ...(settings.trackers || {}), [provider]: account };
  const next: RecorderSettings = {
    ...settings,
    locale,
    provider,
    trackers,
    captureBodies: ($('setBodies') as HTMLInputElement).checked,
  };
  if (provider === 'redmine') {
    next.redmineUrl = account.baseUrl;
    next.apiKey = account.token;
  }
  return next;
}

async function onSave(): Promise<void> {
  const before = currentLocale();
  const next = readForm();
  try {
    await send({ type: 'SETTINGS_SET', settings: next });
    settings = next;
    if (isLocalePref(next.locale)) useLocale(next.locale);
    if (next.locale && next.locale !== before) {
      location.reload();
      return;
    }
    $('testResult').textContent = t('saved');
    window.setTimeout(() => ($('testResult').textContent = ''), 3000);
  } catch (e) {
    showError(e);
  }
}

async function onTest(): Promise<void> {
  $('testResult').textContent = t('connecting');
  try {
    const account = readAccount();
    const info = await send({
      type: 'TEST_REDMINE',
      settings: { redmineUrl: account.baseUrl, apiKey: account.token },
    });
    $('testResult').textContent = t('connected', [info.login, info.name]);
  } catch (e) {
    $('testResult').textContent = '';
    showError(e);
  }
}

$('setProvider').addEventListener('change', () => {
  drafts[provider] = readAccount();
  const next = ($('setProvider') as HTMLSelectElement).value;
  provider = isIssueProvider(next) ? next : 'redmine';
  paint(provider);
});
$('btnSaveSettings').addEventListener('click', () => void onSave());
$('btnTest').addEventListener('click', () => void onTest());
$('btnRecords').addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('manager/manager.html') });
});

void (async function init(): Promise<void> {
  try {
    showVersion();
    settings = await send({ type: 'SETTINGS_GET' });
    provider = isIssueProvider(settings.provider) ? settings.provider : 'redmine';
    ($('setLocale') as HTMLSelectElement).value = isLocalePref(settings.locale) ? settings.locale : currentLocale();
    ($('setBodies') as HTMLInputElement).checked = settings.captureBodies !== false;
    paint(provider);
    (window as unknown as Record<string, unknown>).__bugrecOptReady = true;
  } catch (e) {
    showError(e);
  }
})();
