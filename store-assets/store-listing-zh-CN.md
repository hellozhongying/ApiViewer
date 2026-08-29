# Chrome Web Store 商店信息（简体中文）

## 名称

ApiViewer

## 简短说明

在 Chrome 侧边栏中检查、复制和重放当前标签页的 Fetch / XHR 网络请求。

## 详细说明

ApiViewer 是一款面向 Web 开发和接口调试的 Chrome 侧边栏工具。只有在你主动打开侧边栏并明确授权后，它才会连接当前标签页，实时展示新产生的 Fetch / XHR 请求。

主要功能：

- 查看请求方法、URL、状态码、耗时和传输大小
- 查看请求头、响应头、请求体和响应体
- 搜索并按 XHR / Fetch 类型筛选请求
- 自动格式化 JSON 内容
- 一键复制 cURL、请求体和响应体
- 编辑 URL、参数、请求头和请求体后重新发送
- 使用当前页面登录态重放请求
- 控制最大请求数量和响应体大小
- 暂停、恢复或清空当前捕获会话

隐私与安全：

- 只处理当前活动标签页的 Fetch / XHR
- 只有侧边栏打开期间才连接 Chrome 调试接口
- 捕获记录只保存在浏览器运行内存中
- 不会把请求或响应上传到 ApiViewer 开发者服务器
- 关闭侧边栏后自动断开并清除当前捕获会话
- 不包含分析、广告、遥测或远程执行代码

请注意：请求头、响应体和复制出的 cURL 可能包含 Cookie、Authorization 或其他敏感信息。请勿将捕获内容分享给不受信任的人。编辑并重发会真实访问目标接口，POST、PUT、PATCH、DELETE 等请求可能修改网站数据，发送前请确认目标和参数。

使用限制：

- 只能看到侧边栏打开后新产生的请求
- Chrome Web Store、`chrome://` 等受保护页面不能被调试
- 同时打开 Chrome DevTools 时可能发生调试连接冲突
- 二进制、流式、缓存或超出大小限制的响应可能无法预览

隐私政策：https://hellozhongying.github.io/ApiViewer/privacy.html

支持：https://github.com/hellozhongying/ApiViewer/issues

## 分类建议

Developer Tools / 开发者工具

## 语言

简体中文（zh-CN）

## 成熟内容

否
