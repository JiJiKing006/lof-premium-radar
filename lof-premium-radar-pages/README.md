# LOF 溢价雷达

微信原生小程序 LOF/ETF/QDII 溢价雷达，服务端通过自建 API 抓取并缓存真实行情、净值、申购状态和历史数据。本分支不再保留 H5/Vite 前端。

## 本地运行

```bash
npm install
npm run dev
```

默认服务地址是 `http://127.0.0.1:4173`。如果端口被占用，可以使用：

```bash
PORT=4174 npm run dev
```

## 微信小程序

微信开发者工具直接导入当前 `lof-premium-radar-pages` 目录即可，项目配置位于 `project.config.json`，AppID 为 `wxd827a0e78b5ce07a`。当前项目根目录本身就是小程序根目录，首页和详情页都是原生小程序页面，不使用 `web-view`。

小程序发布版使用线上 `https://jijiking.top`；开发者工具、体验版等非 release 环境使用测试接口 `https://jijiking.top/dev`。业务接口路径保持为 `/api/funds/quotes`、`/api/funds/:code`、`/api/funds/:code/history`，因此开发环境的完整地址示例是 `https://jijiking.top/dev/api/funds/quotes`。真机预览不依赖本机 `127.0.0.1`，需要在微信公众平台把 `https://jijiking.top` 配置为 request 合法域名。

小程序主包只保留原生页面、组件、工具和配置，`project.config.json` 已通过 `packOptions.ignore` 排除服务端、依赖、文档和脚本，避免主包过大。行情数据仍由线上服务端接口获取，不内置、不模拟、不推断行情数据。

## 一键部署

先复制部署配置模板，并按服务器实际信息修改：

```bash
cp .env.deploy.example .env.deploy
```

然后执行：

```bash
npm run deploy
```

部署脚本会依次执行服务端语法检查、测试、打包、上传，并在 Ubuntu 服务器上自动安装/检查 Node.js 20+、Nginx、systemd 服务和 Nginx 反向代理配置。`.env.deploy` 包含服务器地址和 SSH key 路径，已加入 `.gitignore`，不要提交。

小程序发布需要在微信开发者工具中上传代码，`npm run deploy` 只部署线上 API 服务。

## 测试接口部署

测试接口与线上接口运行在同一台服务器，但使用独立的 systemd 服务、端口、发布目录和持久化文件：

```text
线上：https://jijiking.top/api/...      端口 4173，目录 /srv/lof
测试：https://jijiking.top/dev/api/...  端口 4174，目录 /srv/lof-test
```

首次部署及后续更新测试接口都执行：

```bash
npm run deploy:test
```

脚本默认复用 `.env.deploy` 中的 SSH 连接信息；如需覆盖测试端口、路径或测试管理密码，可复制 `.env.test.deploy.example` 为 `.env.test.deploy`。脚本内置生产路径、服务名和端口冲突检查，不会重启生产 API；测试缓存、行情快照、访问统计和订阅登记分别写入 `/srv/lof-test/shared`。测试进程会禁用微信定时推送，避免开发数据触发正式提醒。

## 数据刷新

- 首页、详情页以及后续新增接口都以首屏 1.5 秒内展示真实可用数据为目标。
- 接口返回必须稳定；同一筛选条件下不能出现返回数量大幅跳变、基金分类错乱或详情查询被错误分类污染。
- 如果某个具体字段处理很慢，优先返回已经真实可用的核心数据，慢字段后续补齐或明确显示 `暂无数据` / `净值未公布`。
- 服务端按缓存和源站可用性刷新真实行情数据。
- 如果源站返回限流，API 会继续返回最后一次缓存数据，并在 `meta.status` 和 `meta.stale` 中标记状态。
- 当天价格走势由服务端按基金代码和报价日期累积分钟级价格点。

## 结构

- `app.js`、`app.json`、`app.wxss`：小程序全局入口和样式。
- `pages/`：小程序首页、详情页。
- `components/`：筛选、搜索、状态栏、行情表格等原生组件。
- `utils/`：小程序接口请求、数据归一化、筛选排序、缓存和访问统计。
- `server/`：Express API、缓存、抓取器和数据源配置。
- `server/config/sources.js`：后续新增纳指100、QDII 等数据源时，从这里扩展。
- `data/lof.json`：源站不可用或限流时的冷启动兜底数据。
