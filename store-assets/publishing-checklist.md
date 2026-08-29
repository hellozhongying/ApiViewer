# ApiViewer 上架检查表

## 账号

- [ ] Chrome Web Store 开发者账号注册完成
- [ ] Google 账号已启用两步验证
- [ ] 开发者联系邮箱可正常接收邮件
- [ ] 已按后台要求声明并验证 Trader / Non-trader 身份
- [x] 已决定发布者公开名称：`hellozhongying`

## 隐私和支持页面

- [ ] 将 `privacy.html`、`privacy.css` 和 `icons/icon-128.png` 部署到公开 HTTPS 网站
- [x] 隐私政策已填写发布者 `hellozhongying` 和支持邮箱 `hellozhongying@gmail.com`
- [ ] 确认隐私政策地址无需登录即可访问：`https://hellozhongying.github.io/ApiViewer/privacy.html`
- [ ] 确认 GitHub Issues 已启用：`https://github.com/hellozhongying/ApiViewer/issues`
- [ ] 确认隐私政策、商店描述、Privacy practices 与实际代码行为一致

## 扩展包

- [ ] `manifest.json` 使用 Manifest V3
- [ ] `version` 大于此前提交过的版本
- [ ] 不包含密钥、Cookie、真实接口数据或测试账号
- [ ] 不包含 `.git`、`tests`、`work`、`outputs`、开发脚本和系统隐藏文件
- [ ] ZIP 根目录直接包含 `manifest.json`
- [ ] 在全新的 Chrome Profile 中加载 ZIP 对应目录并完成一次全流程测试

## Store Listing

- [ ] 名称：ApiViewer
- [ ] 简短说明和详细说明已填写
- [ ] 分类选择 Developer Tools
- [ ] 语言选择简体中文
- [ ] 上传 128×128 商店图标
- [ ] 上传至少一张 1280×800 截图
- [ ] 上传 440×280 Small promo tile
- [ ] 根据需要上传 1400×560 Marquee image
- [ ] 填写 Homepage URL（如果有）
- [ ] 填写 Support URL
- [ ] 不使用“官方”“第一”“最佳”等无法证明的宣传语

## Privacy practices

- [ ] 填写单一用途说明
- [ ] 逐项填写 `debugger`、`sidePanel`、`storage`、`tabs`、`clipboardWrite` 理由
- [ ] Remote code 选择 No
- [ ] 如实勾选所有可能处理的数据类型
- [ ] 完成 Limited Use 认证
- [ ] 填写公开隐私政策 URL

## Distribution 和测试

- [ ] 选择 Public、Unlisted 或 Private
- [ ] 选择发布地区
- [ ] 粘贴 `test-instructions.md` 中的审核步骤
- [ ] 无需账号时明确写明“不需要登录信息”
- [ ] 首次提交建议取消自动发布，使用 Deferred publishing
- [ ] 提交审核后持续查看开发者邮箱和后台状态

## 审核通过后

- [ ] 在审核通过后的 30 天内手动发布
- [ ] 安装商店正式版本做一次冒烟测试
- [ ] 保留本次提交的 ZIP、文案和版本号
- [ ] 后续更新先递增 `manifest.json` 的版本号
