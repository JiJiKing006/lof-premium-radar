# LOF 溢价雷达

移动端优先的 Vue3 + Vite 行情看板，服务端通过自建 API 抓取并缓存目标站数据。

## 本地运行

```bash
npm install
npm run dev
```

默认服务地址是 `http://127.0.0.1:4173`。如果端口被占用，可以使用：

```bash
PORT=4174 npm run dev
```

## 构建

```bash
npm run build
npm run preview
```

## 数据刷新

- 前端每 60 秒请求 `/api/funds`。
- 服务端每 60 秒尝试刷新源站数据。
- 如果源站返回限流，API 会继续返回最后一次缓存数据，并在 `meta.status` 和 `meta.stale` 中标记状态。
- 当天价格走势由服务端按基金代码和报价日期累积分钟级价格点。

## 结构

- `src/`：Vue3 前端界面、移动端交互和展示组件。
- `src/domain/`：纯数据格式化逻辑，后续迁移微信小程序时可复用。
- `server/`：Express API、缓存、抓取器和数据源配置。
- `server/config/sources.js`：后续新增纳指100、QDII 等数据源时，从这里扩展。
- `data/lof.json`：源站不可用或限流时的冷启动兜底数据。
