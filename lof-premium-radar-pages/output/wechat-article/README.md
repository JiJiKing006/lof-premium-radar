# 服务号文章发布说明

正文文件：

`/Users/mac/Documents/lof- project/lof-premium-radar-pages/output/wechat-article/wechat_article.md`

带排版的 HTML 版本：

`/Users/mac/Documents/lof- project/lof-premium-radar-pages/output/wechat-article/wechat_article_for_wechat.html`

部署后的线上 HTML 页面：

`http://121.40.152.89/wechat-article/`

HTML 预览截图：

`/Users/mac/Documents/lof- project/lof-premium-radar-pages/output/wechat-article/assets/09-article-preview.png`

建议标题：

`我做了一个 LOF / ETF / QDII 溢价雷达：实时看估值、溢价和申购状态`

建议摘要：

`一个为场内基金做的实时溢价观察工具：看 LOF、ETF、QDII 的现价、估算净值、官方净值、溢价率、申购状态和历史数据。`

网站地址：

`http://121.40.152.89`

## 图片插入顺序

1. `http://121.40.152.89/wechat-article/assets/01-cover.png`
2. `http://121.40.152.89/wechat-article/assets/02a-live-home-mobile.png`
3. `http://121.40.152.89/wechat-article/assets/03-metrics-card.png`
4. `http://121.40.152.89/wechat-article/assets/05-source-card.png`
5. `http://121.40.152.89/wechat-article/assets/04-formula-card.png`
6. `http://121.40.152.89/wechat-article/assets/06-detail-card.png`
7. `http://121.40.152.89/wechat-article/assets/08-support-card.png`

## 发布步骤

方式一：复制 Markdown 正文

1. 打开 `wechat_article.md`，复制正文。
2. 在微信服务号后台新建图文消息，粘贴正文。
3. 按上面的顺序上传并插入图片。
4. 封面图建议使用 `assets/01-cover.png`。
5. 文章末尾赞赏图使用 `assets/08-support-card.png`，其中已经包含收款码。

方式二：复制 HTML 排版版本

1. 优先用浏览器打开 `http://121.40.152.89/wechat-article/`。
2. 页面里全选复制。
3. 粘贴到微信服务号编辑器。
4. 如果微信后台过滤了部分样式，就保留图片和正文结构，再手动微调小标题和重点块。

## 生成说明

封面背景使用内置 `image_gen` 生成，随后保存到：

`assets/fintech-radar-cover-bg.png`

最终文章图片由线上页面截图、HTML 信息卡渲染图和用户提供的收款码组合生成。
