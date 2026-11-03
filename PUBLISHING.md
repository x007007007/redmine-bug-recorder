# 发布指南(Publishing)

## 版本发布(git tag)

版本号以 `manifest.json`、`manifest.firefox.json`、`package.json` 三处同时递增,并且必须相同。标签是 `v` + 版本号,例如 `0.2.5` 对应 `v0.2.5`。

```bash
npm run version:set -- 0.2.5
```

这条命令只改上述三个文件,不移动已经存在的 git tag。提交并推到 GitHub `main` 之后,Actions 发现 `v0.2.5` 还不存在,就在这次提交上创建它,并上传 GitHub Release。`v0.2.4` 这类已经指向旧提交的 tag 不会被改掉;商店和 Release 都按这个号区分版本,同一号不能重复发布。

只推 GitHub。GitHub Actions(`.github/workflows/package.yml`):`main` 每次推送都会打包并保留 14 天构建产物;版本 tag 指向本次提交时再上传到 GitHub Release。用仓库的 `GITHUB_TOKEN` 创建的 tag 不会再次触发 workflow,所以 Release 放在同一次 `main` 任务里上传。

tag 和三处版本号不一致时,GitHub 打包会失败。

## 产出一览

```bash
npm run release      # → release/bug-recorder-chrome-v{ver}.zip  (Chrome Web Store)
                     # → release/bug-recorder-firefox-v{ver}.xpi  (AMO 提交件)
npm run source-zip   # → release/bug-recorder-source-v{ver}.zip   (AMO 要求源码时提交)
```

发版前:用 `npm run version:set -- x.y.z` 同步递增版本号;全部改动 commit(源码包用 git archive,要求工作区干净)。

---

## Firefox(AMO)· 5 分钟手动流程

1. 注册/登录 https://addons.mozilla.org/developers/
2. 「Submit a New Add-on」→ 选择 **「On your own site」**(自行分发 = unlisted 签名,内部团队用这个)
3. 上传 `release/bug-recorder-firefox-v{ver}.xpi`
4. 若提示需要源码(打包产物常触发):上传 `release/bug-recorder-source-v{ver}.zip`,备注里写
   "See REBUILD.md inside; `npm install && npm run release` reproduces the exact xpi."
5. 等待签名(unlisted 通常几分钟到一两天)→ 在开发者主页下载 **signed xpi** → 发给团队
6. 团队安装:拖 xpi 进 Firefox 即可永久安装;或 about:debugging 临时载入试用

> 更新版本:重复上述流程上传新版本 xpi(gecko id 必须保持 `bug-recorder@x007007007` 不变)。

## Chrome Web Store · 不公开分发

1. 注册 https://chrome.google.com/webstore/devconsole(一次性 $5)
2. 「新增项」→ 上传 `release/bug-recorder-chrome-v{ver}.zip`
3. 商店资料:分类「开发者工具」、图标 `icons/icon128.png`、截图(管理页 + DevTools 面板)
4. 「隐私权」→ 分发可见性选 **不公开(Unlisted)**
5. 权限用途说明(审核必问,粘贴):
   > The extension records UI interactions, network requests (webRequest) and optionally response
   > bodies (chrome.debugger) on the sites being tested, to generate bug reports for Redmine. All
   > data stays in local IndexedDB; nothing is sent until the user clicks Submit, and only to their
   > own Redmine server. `<all_urls>` is required because testers target arbitrary internal sites
   > and each step needs tabs.captureVisibleTab screenshots.
6. 隐私声明勾选:不收集用户数据 / 不出售数据 / 单一用途
7. 提交审核(unlisted + 宽权限通常 1~2 周)

## 企业策略强推(不进商店,可选)

- Chrome:`ExtensionInstallForcelist` = `bkeogdmbgodhopooimgmbacldmdmpeap;https://clients2.google.com/service/update2/crx`
- Firefox:`ExtensionSettings` =
  ```json
  { "bug-recorder@x007007007":
     { "install_url": "https://内网/bug-recorder-firefox-v{ver}-signed.xpi",
       "installation_mode": "force_installed" } }
  ```

## 固定标识(勿改)

- Chrome:manifest 内置 `key` → ID 恒为 `bkeogdmbgodhopooimgmbacldmdmpeap`
- Firefox:`browser_specific_settings.gecko.id` = `bug-recorder@x007007007`

## 质量门(发版前)

```bash
npm test            # 单元测试(不需要浏览器)
npm run typecheck   # tsc strict(含 tests/)
npm run build       # 构建 dist/
npm run smoke       # 50 项端到端断言(需 demo 双服务 + CfT 浏览器)
npx web-ext lint    # Firefox 官方检查(对 dist 或解包后的 xpi;当前 0 errors)
```
