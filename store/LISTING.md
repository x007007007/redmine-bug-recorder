# 商店介绍 / Store listing

浏览器里的名称和一行简介来自 `_locales/*/messages.json` 的 `extName`、`extDescription`。语言跟随浏览器;没有对应语言时用简体中文。下面是商店详情页可用的长介绍。

The name and one-line summary shown by the browser come from `extName` and `extDescription` in `_locales/*/messages.json`. The language follows the browser. Locales without a translation use Simplified Chinese. The longer text below is for the store listing page.

## 简体中文

**简介**

测试助手:记录 UI 操作步骤(每步自动截图)与 API 交互,一键提交 Bug 到 Redmine。

**详细介绍**

Bug Recorder for Redmine 给测试人员用。在被测网站上点「开始录制」之后,点击、输入、下拉、提交和页面跳转都会记成步骤,每步附一张可视区域截图。XHR / Fetch 的方法、地址、状态码、耗时和请求体会按时间插进同一步骤;Chrome 还可以记下响应体和 Console。Vue 3 页面会标出组件名、props,以及 Pinia 的状态变化和 action 调用。

录完回到管理页,按页面(大步骤)查看时间线,勾选要提交的步骤,改好描述,再提交到 Redmine。可以只提交时间轴上的一段,也可以把同一份记录导出成 CSV。右键页面元素可以写修改意见,表单开在扩展自己的窗口里,不会插入被测页面。

记录里的输入值保持原样,包括密码,提交前请自己核对。请求范围默认只记当前标签页,发往已配置 Redmine 地址的请求不会被记录。

许可为 PolyForm Noncommercial 1.0.0。非商业使用可以复制、修改和分发;商业使用请先写信给 x007007007@hotmail.com 取得书面授权。

## English

**Summary**

Record UI steps with a screenshot each, capture API calls, and file the bug in Redmine.

**Description**

Bug Recorder for Redmine is for testers. After you click Start on the site under test, clicks, typing, selects, submits, and navigations become steps, each with a screenshot of the viewport. XHR and fetch calls (method, URL, status, duration, and request body) are placed on the same timeline. On Chrome, response bodies and the console can be recorded too. Vue 3 pages are annotated with the component name, props, and Pinia state changes and action calls.

Back on the manager page, review the timeline grouped by page, check the steps to include, edit the description, and submit it to Redmine. You can submit only a slice of the timeline, or export the same record as CSV. Right-click an element to write a change note. The form opens in the extension's own window and is not injected into the page under test.

Recorded values are kept as typed, including passwords. Review them before you submit. Request capture defaults to the current tab. Requests sent to the configured Redmine URL are never recorded.

License: PolyForm Noncommercial 1.0.0. You may copy, modify, and distribute it for noncommercial use. Commercial use needs prior written permission from x007007007@hotmail.com.
