# Privacy practices 填写稿

## Single purpose description

帮助用户在主动打开 Chrome 侧边栏并明确授权后，检查、复制和重放当前标签页的 Fetch / XHR 网络请求。

## Permission justification

### debugger

ApiViewer 仅在用户打开侧边栏并完成明确授权后，使用 Chrome Debugger API 连接当前活动标签页。扩展通过 Chrome DevTools Protocol 的 Network 域读取用户界面中展示的 Fetch / XHR 请求、响应和响应体，并通过 Runtime 域在用户点击“发送请求”后重放用户编辑的请求。关闭侧边栏后会立即解除调试连接。

### sidePanel

用于在 Chrome 原生侧边栏中展示 ApiViewer 的请求列表、请求详情、设置和请求重放界面。扩展的主要用户界面完全位于侧边栏内。

### storage

仅使用 `chrome.storage.local` 在用户设备上保存最大请求数量、最大响应体大小、自动捕获设置，以及用户对隐私披露的授权版本和授权时间。捕获到的请求和响应不会写入持久化存储。

### tabs

用于识别当前活动标签页、读取其 URL 和标题、判断页面是否属于 Chrome 受保护页面，并在用户切换活动标签页时更新检查目标。该权限不用于建立或上传浏览历史。

### clipboardWrite

仅在用户点击复制按钮后，将用户选择的 cURL、请求体、响应体或当前详情写入系统剪贴板。扩展不会读取剪贴板。

## Remote code

选择：`No, I am not using remote code.`

补充说明：扩展所有可执行 JavaScript 均随扩展包提供，不从外部服务器、CDN 或远程配置下载 JavaScript 或 WebAssembly，也不会执行从网络响应中获得的代码。请求重放使用扩展包内定义的固定函数和用户确认的结构化请求参数。

## User data categories

不要选择“本扩展不收集或使用用户数据”。Chrome 的政策把仅在本机处理的数据也视为需要披露的数据处理。

明确适用的类别：

- Web history / Web browsing activity：处理当前标签页访问的 URL 和网络资源 URL。
- Website content：处理 HTTP 请求和响应的标头及正文。
- Authentication information：请求头可能包含 Cookie、Authorization 或其他认证信息。
- User activity：处理用户在扩展中执行的搜索、筛选、复制和重放操作，仅用于提供对应界面功能，不作分析或上传。

由于这是通用网络检查器，请求和响应正文还可能包含以下类别。后台出现对应复选框时，建议如实勾选并在政策中说明内容取决于用户访问的网站：

- Personally identifiable information
- Personal communications
- Financial and payment information
- Health information
- User-generated content / Form data（如果后台提供此项）

## Data use certifications

在确认代码行为没有变化后，可以认证：

- 不向第三方出售用户数据。
- 不将用户数据用于与单一用途无关的目的。
- 不将用户数据用于贷款资格或信用评估。
- 不将用户数据用于个性化广告或再营销。
- 除政策允许的有限例外外，不允许人类读取用户数据。
- 数据处理遵守 Chrome Web Store User Data Policy 的 Limited Use 要求。

## Privacy policy URL

https://hellozhongying.github.io/ApiViewer/privacy.html
