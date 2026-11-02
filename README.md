# Bug Recorder for Redmine

测试助手浏览器插件(Chrome MV3 / Firefox MV3):录制 UI 测试操作过程,每步自动截图,捕获 API 交互与 Vue/Pinia 状态,勾选 review 后一键提交 Bug 到 Redmine。

## 功能

- **操作录制**:点击、键盘输入(防抖合并)、下拉选择、表单提交、页面跳转(SPA 路由变化也算一步);**可跨标签页**(页面标题会标注「标签页 N」)
- **每步自动截图**:每次操作约 380ms 后截取可视区域(JPEG);若期间已切走标签页则跳过,宁缺勿错
- **API 交互捕获**:URL / 方法 / 状态码 / 耗时 / 请求体;开启"捕获请求响应体"后还含响应体与 Console 错误(chrome.debugger,仅 Chrome)
- **统一时间线**:URL 为大步骤(页面,含起止时间与先后顺序),页面内操作 / API / Pinia 事件**按时间交错记录**,不再分区展示
- **大步骤视图**:默认最新页面在前,可切正序/逆序(只排页面,不动页内顺序);支持搜索过滤与折叠
- **步骤删除**:每个小步骤与整页均可删除,描述与截图联动更新
- **Vue 优化**(针对 Vue 3 + Pinia 项目):
  - 每个操作标注所在 Vue 组件(名称 + 组件链,如 `AddOrderForm (AddOrderForm > OrderApp)`)
  - 组件 props 点击时刻快照,并与上次同组件 diff:`title: "" → "三体"`
  - Pinia:`$subscribe` 记录状态变更流(哪个 store / 哪些 key)、`$onAction` 记录 action 调用、每次操作对比 store 快照
- **步骤勾选 + review 后提交**:值原样记录(不做脱敏),测试人员在管理页勾选要提交的步骤、可编辑描述后,才上传截图并创建 issue(Redmine 描述中的步骤始终按时间正序)
- **提交范围**:默认只取**最近 100 步**;DevTools 面板可在时间轴上框选区间,提交页按区间裁剪(可"查看全部 / 恢复默认")
- **截图限量**:提交时"最多附加截图 N 张"(超出取最近),避免 issue 附件爆炸
- **点击标记**:点击类操作记录视口坐标;截图缩略图/大图/上传件上叠加半透明点击标记(上传件用 OffscreenCanvas 烙入 PNG 透明通道)
- **CSV 导出**:操作/API/Pinia 按时间交错导出 CSV(Excel 可开),截图列含 base64
- **DevTools 面板**(类似 Vue Devtools):时间轴缩略图条(点击定位大步骤)、大步骤分页列表、选范围一键去提交
- **一键提交 Redmine**:`POST /uploads.json` → `POST /issues.json`;项目支持列表选择或**手动填项目标识/ID**(列表为空时仍可提交)

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

1. 管理页、弹窗或 **DevTools 面板**(F12 → 「Bug Recorder」标签页)点 **「开始录制」**
2. 在业务页面正常操作(跨标签页也会被记录)
3. 发现 Bug 后回到提交页(管理页):
   - 左侧选择会话;默认只加载最近 100 步,可"查看全部"
   - **勾选**相关步骤(描述实时联动)、可删除无关步骤
   - **review 描述**(输入值原样记录,可编辑;Markdown)
   - 选择项目(或手动填项目标识)→ **「提交到 Redmine」**,截图按 `step-NN.jpg/png` 附件上传(限量可调)

DevTools 面板的时间轴:每步截图按时间排列,点击缩略图定位到对应大步骤;勾选"选范围"后依次点击两张截图成区间 → 「按此范围去提交」自动打开提交页并裁剪。大步骤多时列表自动分页(每页 5 个)。

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

约定:所有 JS 模块 ≤ 200 行左右,便于维护。

```
manifest.json            Chrome MV3(background 双写 service_worker+scripts,Firefox 也能载)
manifest.firefox.json    Firefox MV3 变体
background/
  service-worker.js      入口(注册各模块监听器)
  state.js               录制状态 / 设置 / 徽章 / 通知
  net-capture.js         webRequest 捕获(元数据+请求体)
  net-cdp.js             chrome.debugger 捕获(响应体+Console,仅 Chrome)
  recorder.js            开始/停止、操作与 Pinia 事件入库、截图管线(防拍错标签页)
  sessions.js            会话查询 / 删除(会话级与条目级)
  redmine-submit.js      连接测试 / 下拉数据 / 提交 issue
  router.js              消息路由
content/
  dom-meta.js            (隔离世界)选择器 / 字段标签工具
  recorder.js            (隔离世界)事件录制 + 主世界探针桥
  probe-serialize.js     (主世界)安全序列化
  vue-probe.js           (主世界)Vue 组件/props/Pinia 捕获
shared/
  describe.js            可读文案与时间格式
  timeline.js            统一时间线:页面分组 / 归属 / 排序 / 搜索 / props diff
  report.js              Redmine 描述生成(页面内操作与 API 交错)
  db.js                  IndexedDB(sessions/actions/requests/logs/pinia)
  redmine.js             Redmine REST API 客户端
popup/                   弹窗(开始/停止/入口)
manager/                 管理页模块:store / dom / api / settings-ui / sessions-ui /
                         entry-ui / page-ui / steps-ui / report-ui / range / export-csv
devtools/                DevTools 面板(devtools.js 注册 + panel 时间轴/分页/选区)
demo/                    本地演示:普通页 + Vue3+Pinia 页 + 假 Redmine
tools/cdp_smoke.mjs      端到端冒烟测试(Node 21+ 零依赖,40 项断言)
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
- **Redmine 项目列表为空**属服务端可见性:`/projects.json` 只返回该账号可见的项目,普通账号须先成为某项目成员(或用管理员账号);插件已支持手动填项目标识/ID 直接提交
- DevTools 面板仅 Chrome 系(Firefox 不支持 chrome.devtools API 时面板不注册,其余功能不受影响)

## 后续可扩展

- 录屏模式(rrweb)与操作时间轴联动
- Jira/禅道适配器(提交层已隔离在 `shared/redmine.js` + SW `submitRedmine`)
- 自定义字段映射、issue 模板
- 会话导入导出(已支持导出 JSON)
