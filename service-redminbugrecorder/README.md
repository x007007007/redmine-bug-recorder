# service-redminbugrecorder — 本地 Redmine 测试服务

给 redmine-bug-recorder 插件提供**真实 Redmine** 的端到端联调环境（demo/server.py 的假 Redmine 只覆盖 uploads/issues 两个接口，这里跑的是完整 Redmine 6.0）。

- 地址：`http://127.0.0.1:13000`（宿主机 3000 已被占用，故映射 13000 → 容器 3000）
- 账号：`admin` / `Redmine@2026`（语言已设为简体中文）
- REST API：已开启（Administration 设置项 `rest_api_enabled`）
- **API Key（AK）**：`service-redminbugrecorder/.env` 的 `REDMINE_AK=`（该文件已在仓库根 .gitignore，勿提交勿外传）

## 目录内容

| 文件 | 用途 |
| --- | --- |
| `docker-compose.yml` | Redmine 6.0 + PostgreSQL 16，数据落 `./data/`（gitignore） |
| `init.rb` | rails runner 脚本：开 REST、设默认语言、admin 密码、生成/复用 AK |
| `init.sh` | 一键初始化（等就绪 → 默认数据 → init.rb → 写 .env → 验证 API），幂等 |
| `setup.mjs` | 幂等创建层级项目树 + 问题类别，并核验（零依赖，Node ≥ 18） |
| `pull-image.py` | Docker Hub 不可达时的宿主机旁路拉取（见下「网络受限说明」） |
| `.env` | `REDMINE_URL / REDMINE_AK / ADMIN_*`（gitignore，勿提交） |
| `data/` | Postgres 数据与 Redmine 附件（gitignore） |

## 常用命令

```bash
cd service-redminbugrecorder

docker compose up -d          # 启动（首次自动建库）
./init.sh                     # 初始化 + 生成 AK 写入 .env（幂等，重复执行安全）
node setup.mjs                # 创建层级项目/类别（幂等）
node setup.mjs --verify-only  # 只核验不创建

docker compose down           # 停止（保留数据）
docker compose down -v && rm -rf data   # 彻底清空重来
```

初始化好的数据（`setup.mjs` 创建）：

```
演示系统 (demo-system, id=1)          类别: 界面/接口/数据
├─ 前端模块 (demo-frontend, id=2)     类别: 界面/交互
├─ 后端模块 (demo-backend, id=3)      类别: 接口/数据
└─ 移动端 (demo-mobile, id=4)         类别: 界面/同步
跟踪标签: 1:错误  2:功能  3:支持（Redmine 默认数据,简体中文）
```

## 插件端到端测试

```bash
# 仓库根目录执行
npm run build
node tools/dev-launch.mjs chrome --no-build --cdp-port=9223
node tools/cdp_redmine_e2e.mjs 9223 bkeogdmbgodhopooimgmbacldmdmpeap
```

`cdp_redmine_e2e.mjs` 走完整流程并逐项断言：配置页连接测试 → 列项目（层级缩进）→ tracker/优先级下拉 → 录制 demo 操作 → 提交带截图的 issue → 从 Redmine API 反查验证（项目/tracker/优先级/描述/附件数）→ 手填项目标识（demo-backend）再提交一条（带 CSV）→ 再次反查。AK 自动从本目录 `.env` 读取。

## 网络受限说明（为什么有 pull-image.py）

本机 Docker Desktop 的内置代理链路（`http.docker.internal:3128`）失效且 Docker Hub 直连不可达，daemon 侧 `docker pull` 会无限黑洞；而 `~/.docker/daemon.json` 里配置的两个 registry-mirror 一个已失效、一个仅 daemon 生效但同样走坏掉的代理。在**不重启 Docker Desktop**（避免影响其他在跑容器）的前提下，用 `pull-image.py` 在宿主机侧直接从可达的镜像源（默认 `registry.orangejx.cn`）下载镜像层并 `docker load` 导入：

```bash
python3 pull-image.py                # 默认 library/redmine 6.0
python3 pull-image.py library/redmine 6.0 https://registry.orangejx.cn --force
```

## 验证结果（2026-11-18）

- `setup.mjs` 12 项核验全过，重复执行无副作用
- `tools/cdp_redmine_e2e.mjs` 14/14 PASS；issue [#7](http://127.0.0.1:13000/issues/7)（前端模块/错误/高/2111 字描述/3 张截图）、[#8](http://127.0.0.1:13000/issues/8)（后端模块/CSV 附件）在 Redmine 侧反查一致
- 插件单测 35/35（含新增的层级排序用例）
