# 参与开发

需要 Node.js 20 或更新版本。Windows 可执行打包脚本，浏览器测试使用 Playwright 的隔离 Chromium。

```sh
npm ci
npm test
npx playwright install chromium --no-shell
npm run test:browser
```

在 Chrome/Edge 扩展管理页加载 `extension/`，修改后重新加载。调试启用后出现浏览器提示属于正常行为。

提交修改时请说明解决的问题、验证方式和兼容性影响。匹配、响应头、项目状态或日志逻辑变化应添加相应回归测试。浏览器测试仅使用仓库内的本地测试服务器，不依赖第三方站点。

请勿提交用户规则、导入脚本、账号信息、第三方扩展源码、浏览器配置或带令牌的 URL。报告问题前请去掉敏感查询参数，并尽量提供最小本地示例。

## 打包

Windows 上运行 `npm run release`。先保持 package.json 和 manifest.json 的版本一致，更新 CHANGELOG.md，执行单元测试和浏览器回归。输出为 `releases/rejs-版本.zip` 及 SHA-256 校验文件；生成文件不提交到 Git。
