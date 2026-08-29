# GitHub 仓库与 Pages 配置

## 推荐结构

将整个 ApiViewer 项目推送到一个公开仓库，并保留以下目录：

```text
ApiViewer/
├── manifest.json
├── background.js
├── sidepanel.html
├── sidepanel.css
├── sidepanel.js
├── privacy.html
├── privacy.css
├── icons/
├── docs/
│   ├── .nojekyll
│   ├── index.html
│   ├── privacy.html
│   ├── privacy.css
│   └── icons/icon-128.png
└── store-assets/
```

`docs/` 是 GitHub Pages 发布目录，扩展源码仍保存在仓库根目录。

## GitHub Pages 设置

1. 在 GitHub 创建公开仓库，推荐名称 `ApiViewer`。
2. 将本地项目提交并推送到仓库的 `main` 分支。
3. 打开仓库的 `Settings` → `Pages`。
4. 在 `Build and deployment` 下，将 `Source` 设为 `Deploy from a branch`。
5. Branch 选择 `main`，Folder 选择 `/docs`，点击 `Save`。
6. 等待 Pages 部署完成，然后访问后台显示的公开 URL。

本项目已确定使用 GitHub 用户名 `hellozhongying` 和仓库名 `ApiViewer`：

```text
隐私政策：https://hellozhongying.github.io/ApiViewer/privacy.html
支持页面：https://github.com/hellozhongying/ApiViewer/issues
项目主页：https://github.com/hellozhongying/ApiViewer
```

在确认实际 URL 可以匿名访问后，再把它们填写到 Chrome Web Store 和 `store-assets/` 文案中。

## 建议的仓库设置

- 启用 Issues，作为 Chrome Web Store 的 Support URL。
- 不要提交 Cookie、Authorization、真实接口响应、开发者账号凭据或 `.pem` 私钥。
- 发布前检查提交历史，确保敏感数据从未被提交。
- 如果暂时不希望开放源码，可以只公开一个 Pages 仓库托管隐私政策；但将当前源码一并公开也完全可行。
