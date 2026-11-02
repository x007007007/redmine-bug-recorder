# Bug Recorder for Redmine

测试助手浏览器插件(Chrome MV3 / Firefox MV3):录制 UI 测试操作过程,每步自动截图,捕获 API 交互与 Vue/Pinia 状态,勾选 review 后一键提交 Bug 到 Redmine。

## 功能

- **操作录制**:点击、键盘输入(防抖合并)、下拉选择、表单提交、页面跳转(SPA 路由变化也算一步)
- **每步自动截图**:每次操作约 380ms 后截取可视区域(JPEG),UI 渲染完成后再截
- **API 交互捕获**:URL / 方法 / 状态码 / 耗时 / 请求体;开启"捕获请求响应体"后还含响应体与 Console 错误(chrome.debugger,仅 Chrome)
- **URL 大步骤分组**:每个 URL 是一个大步骤(页面),组内的点击/输入是小步骤
- **Vue 优化**(针对 Vue 3 + Pinia 项目):
  - 每个操作标注所在 Vue 组件(名称 + 组件链,如 `AddOrderForm (AddOrderForm > OrderApp)`)
  - 组件 props 点击时刻快照,并与上次同组件 diff:`title: "" → "三体"`
  - Pinia:`$subscribe` 记录状态变更流(哪个 store / 哪些 key)、`$onAction` 记录 action 调用、每次操作对比 store 快照
- **步骤勾选 + review 后提交**:值原样记录(不做脱敏),测试人员在管理页勾选要提交的步骤、可编辑描述后,才上传截图并创建 issue
- **一键提交 Redmine**:`POST /uploads.json` 上传 `step-NN.jpg` → `POST /issues.json` 创建 issue(支持项目/跟踪/优先级)

## 安装

### Chrome(正式浏览器)

1. 打开 `chrome://extensions`,右上角开启「开发者模式」
2. 「加载已解压的扩展程序」选择本目录(`redmine-bug-recorder/`)
3. ⚠️ 注意:品牌版 Chrome 137+ 命令行 `--load-extension` 已失效,但「加载已解压」不受影响

### Firefox

```bash
# 临时加载(重启失效,适合试用)
web-ext run --source-dir . --config-discovery
# 或 about:debugging#/runtime/this-firefox → 临时载入附加组件 → 选 manifest.firefox.json
```

Firefox 用 `manifest.firefox.json`(无 `chrome.debugger`,响应体/Console 不捕获;需 Firefox 128+,`world: MAIN` 支持从此版本开始)。正式分发需在 addons.mozilla.org 签名。

## 配置 Redmine

管理页(工具栏图标 → 「打开管理页」)→ ⚙️ 设置:

- **Redmine 地址**:如 `https://redmine.example.com`
- **API Key**:Redmine →「我的账号」页面右侧「API 访问键」
- **捕获 API 请求/响应体**:勾选后经 chrome.debugger 捕获(浏览器顶部会出现"正在调试此浏览器"横幅,属正常;取消横幅则自动降级为仅记录请求元数据)

提交前点「载入」拉取项目列表,选择项目/跟踪/优先级。

## 使用流程

1. 管理页或弹窗点 **「开始录制」**
2. 在业务页面正常操作(新开标签页也会被记录)
3. 发现 Bug 后回到管理页:
   - 左侧会话列表选择会话
   - **勾选**与 Bug 相关的大步骤/小步骤(描述实时联动)
   - **review 描述**(输入值原样记录,可编辑;Markdown 格式)
   - 选择项目 → **「提交到 Redmine」**,得到 issue 链接(截图按 `step-NN.jpg` 附件上传)

## 生成的 issue 描述格式

```markdown
## 复现步骤
### 大步骤 1 · 页面 https://app.example.com/login(登录)
1. 在「用户名」中输入 "demo"
   - 元素: `input#username`
   - 截图: step-01.jpg
2. 点击「登录」
   - Vue 组件: LoginForm (App > LoginForm)
   - 组件 props(点击时): `{"loading": false}`
   - props 变化: loading: false → true
   - Pinia store `auth` 状态变化,当前值: `{...}`

## 时序详情(按小步骤)
**小步骤 2(点击「登录」)之后:**
- Pinia: 调用 `auth.login()` 参数 ["demo","***"]
- API: `POST /api/login` → **500** · 342ms ⚠️
  - 请求体: `{...}`
  - 响应体: `{...}`
```

## 项目结构

```
manifest.json            Chrome MV3(含 MAIN world Vue 探针声明)
manifest.firefox.json    Firefox MV3 变体
background/service-worker.js   录制编排:截图管线 / webRequest+CDP 网络捕获 / Redmine 提交
content/recorder.js      隔离世界:DOM 事件录制 + 主世界探针桥
content/vue-probe.js     主世界:Vue 组件/props/Pinia 捕获
shared/db.js             IndexedDB(sessions/actions/requests/logs/pinia)
shared/report.js         Markdown 描述生成(分组/勾选过滤/props diff)
shared/redmine.js        Redmine REST API 客户端
popup/                   弹窗(开始/停止/入口)
manager/                 管理页(会话/步骤勾选/API/Pinia/提交表单/设置)
demo/                    本地演示:普通页 + Vue3+Pinia 页 + 假 Redmine
tools/cdp_smoke.mjs      端到端冒烟测试(Node 21+ 零依赖,28 项断言)
tools/gen_icons.py       图标生成
```

## 本地联调 / 测试

```bash
# 两个终端分别启动(假 Redmine 的 API Key 固定为 test-key)
python3 demo/server.py          # 演示应用 http://127.0.0.1:8123(登录 demo/demo123)
python3 demo/server.py redmine  # 假 Redmine http://127.0.0.1:8124

# 端到端冒烟(需 Node ≥ 21;默认用本机 Playwright 缓存的 Chrome for Testing)
CFT="$HOME/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
"$CFT" --headless=new --remote-debugging-port=9223 --user-data-dir=/tmp/bugrec-profile \
  --no-first-run "--disable-extensions-except=$PWD" "--load-extension=$PWD" about:blank &
sleep 4
node tools/cdp_smoke.mjs 9223 bkeogdmbgodhopooimgmbacldmdmpeap "$PWD"
```

最近一次全量结果:**28/28 PASS**(含 Vue 组件名、props diff、Pinia 事件、步骤勾选联动、11 张截图上传)。

## 隐私与安全

- 按需求**不做自动脱敏**:输入值(含密码)、API 请求/响应体、Pinia 状态均原样记录,仅做长度截断。**全部数据只存本机 IndexedDB**,只有点「提交」才会外发,且只发勾选的步骤与截图
- API Key 存于浏览器本地 `storage.local`,不与其他机器同步
- 建议:涉及敏感系统的测试,提交前 review 描述与截图;不需要响应体时可关闭"捕获请求/响应体"

## 已知限制

- Vue 组件名/props 依赖 `el.__vueParentComponent`:**dev/Vite 构建 100% 可用;生产构建不保证**(自动降级为普通步骤,Pinia 捕获不受影响)
- 响应体与 Console 捕获仅 Chrome(Firefox 无 chrome.debugger);二进制响应不落库
- `captureVisibleTab` 要求 `<all_urls>` 权限(已声明);浏览器受保护页面(chrome:// 等)无法截图,自动跳过
- 键盘输入按 700ms 防抖合并为一条"输入"步骤;回车单独记一步
- iframe 内操作可记录(content script all_frames);跨域 iframe 截图无碍(截的是整页可视区)

## 后续可扩展

- 录屏模式(rrweb)与操作时间轴联动
- Jira/禅道适配器(提交层已隔离在 `shared/redmine.js` + SW `submitRedmine`)
- 自定义字段映射、issue 模板
- 会话导入导出(已支持导出 JSON)
