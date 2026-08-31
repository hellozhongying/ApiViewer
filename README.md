# ApiViewer

ApiViewer 是一个 Manifest V3 Chrome 侧边栏扩展，用于捕获当前标签页产生的 Fetch / XHR 请求。项目不需要安装依赖或执行构建命令，当前目录可以直接作为“已解压的扩展”加载。

## 安装

推荐直接从 [Chrome Web Store 安装 ApiViewer](https://chromewebstore.google.com/detail/emnmbnciefkdobogcfghoelgnncobfnm?utm_source=item-share-cb)。

如需本地开发或调试，也可以加载已解压的扩展：

1. 在 Chrome 地址栏打开 `chrome://extensions/`。
2. 打开右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择此目录：`/Users/zhongying/Documents/ChatGPT/ApiViewer`。
5. 打开任意普通网页，点击工具栏中的 ApiViewer 图标；如果图标未显示，可先在扩展菜单中固定它。
6. 首次使用时阅读数据处理说明，点击“同意并开始捕获”。未授权前扩展不会连接调试器或读取网络请求。
7. 打开侧边栏后刷新网页或执行页面操作，即可看到新产生的 Fetch / XHR 请求。

Chrome 会提示 ApiViewer 正在调试当前标签页，这是使用 Chrome DevTools Protocol 读取响应体时的正常安全提示。关闭 ApiViewer 侧边栏后，调试连接会自动解除。

## 已实现功能

- 只捕获当前标签页的 Fetch / XHR 请求。
- 实时显示方法、请求路径、状态码、耗时和传输大小。
- 支持关键词搜索、“全部 / XHR / Fetch”筛选，以及用上下方向键切换选中的请求。
- 查看概览、请求体、响应体和请求头。
- 可将已捕获的请求复制为独立草稿，编辑 Method、URL、查询参数、请求头和 JSON / Form / Raw 请求体后，在当前页面登录态下重新发送并查看响应。
- 自动格式化 JSON，并支持复制当前详情内容。
- 一键复制 cURL、请求体和响应体。
- 暂停 / 恢复捕获、清空记录、连接失败重试。
- 可设置最大请求数量、最大响应体大小和自动捕获行为。
- 标签页切换后自动切换捕获目标；关闭侧边栏后自动停止。
- 首次捕获前展示隐私说明并取得明确授权；完整政策可从扩展设置中随时打开。

## 使用限制

- ApiViewer 只显示侧边栏打开后新产生的请求，打开前的历史请求无法补抓。
- `chrome://`、Chrome Web Store 等受保护页面不能被扩展调试。
- 同一标签页同时打开 Chrome DevTools 时，Chrome 可能让 DevTools 接管调试连接；关闭 DevTools 后点击“重新连接”即可。
- 超过设置上限的响应体、二进制响应、流式响应或部分缓存响应可能无法直接预览。
- 复制的 cURL 可能包含 Cookie、Authorization 等敏感请求头，请勿直接分享给不受信任的人。
- 重放请求会真实访问目标接口；POST、PUT、PATCH、DELETE 等请求可能修改或删除网站数据，发送前请确认目标和参数。
- Cookie、Host、Origin、Content-Length、`Sec-*` 等由浏览器管理的请求头在重放编辑器中只读，发送时使用当前标签页的实际页面环境。
- 重放暂不直接预览二进制响应，也不保证可以复原 multipart、流式请求或包含文件上传的请求体。
- 请求和响应数据只保存在扩展运行内存中，不会上传到任何服务器；关闭侧边栏即释放当前捕获会话。

## Chrome Web Store 上架材料

商店文案、权限理由、审核测试说明、隐私政策和图片素材位于 `store-assets/`。生成发布包前，请先按照 `store-assets/README.md` 替换发布者名称、支持邮箱和公开 HTTPS 地址。

## 本地校验

```bash
node --test tests/background.test.mjs
node --check background.js
node --check sidepanel.js
```

图标如需重新生成：

```bash
node scripts/generate-icons.mjs
```
