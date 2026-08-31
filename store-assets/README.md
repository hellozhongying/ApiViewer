# ApiViewer Chrome Web Store 上架材料

本目录中的文案可直接复制到 Chrome Web Store Developer Dashboard。提交前必须先完成以下替换：

- 发布者名称已填写为 `hellozhongying`。
- 支持邮箱已填写为 `hellozhongying@gmail.com`。
- 隐私政策地址已填写为 `https://hellozhongying.github.io/ApiViewer/privacy.html`。
- 支持页面已填写为 `https://github.com/hellozhongying/ApiViewer/issues`。

文件说明：

- `store-listing-zh-CN.md`：商店名称、摘要、详细描述和分类建议。
- `store-listing-en.md`：英文商店名称、摘要、详细描述和分类建议。
- `privacy-practices.md`：单一用途、权限理由、远程代码和数据类型声明。
- `test-instructions.md`：提供给 Chrome 审核人员的测试步骤。
- `publishing-checklist.md`：从上传到发布的逐项检查表。
- `github-pages.md`：GitHub 仓库与 Pages 配置步骤。
- `privacy-policy.md`：可托管到官网或 GitHub Pages 的隐私政策 Markdown 源稿。
- `images/`：商店图标、截图和宣传图。

根目录的 `privacy.html` 与 `privacy.css` 是同一政策的浏览器版。它们既会打入扩展包供用户随时查看，也可以直接部署为公开隐私政策页面。

完成所有占位符替换后运行：

```bash
node scripts/package-release.mjs
```

脚本会拒绝带占位符的内容，并在 `release/` 中生成只包含运行文件的 ZIP。
