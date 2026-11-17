# 远端部署与维护

目标仓库：https://github.com/yydshly/mirror-coast-web

目标网址：https://yydshly.github.io/mirror-coast-web/

这是独立发布子项目；原型工程的开发追踪、个人存档、缓存和研究材料不在发布范围内。

## GitHub Pages

1. 仓库 Settings → Pages → Source 选择 **GitHub Actions**。
2. 将代码推送到 main；工作流运行 npm ci、npm test、npm run build。
3. 构建成功后，部署任务发布同一个 dist 构建产物。
4. Actions的部署任务和仓库Environments显示实际状态与访问地址。失败时先看对应步骤日志，不能把已推送视为已上线。

工作流固定GitHub官方Actions的提交SHA。构建任务只读源码，部署任务才拥有Pages和OIDC权限；不需要手工添加长期部署令牌。

参考：[Vite静态发布](https://vite.dev/guide/static-deploy.html#github-pages)、[GitHub Pages自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 资源路径与其他托管

vite.config.ts的base为相对路径，适配GitHub Pages的项目子路径。Worker随构建打包；Rapier兼容包内含WASM数据，不需要额外WASM服务。

其他静态托管使用：

- 安装：npm ci
- 构建：npm run build
- 输出：dist
- Node：22.12+，推荐22
- 不需要服务器环境变量或API密钥。

将dist目录内容作为站点根目录提供，JavaScript文件必须有正确MIME类型。不要把源码目录直接当作生产站点，也不要把vite preview作为公网生产服务器。

## 上线检查

- 试玩页能够加载，JS、CSS、favicon和两个Worker无404。
- 场景实际绘制，帮助、地图、模式切换和基本移动可用。
- 独立浏览器状态下编辑，刷新后修改仍在。
- 浏览器控制台无未处理异常；记录已有兼容性警告，不冒称零警告。
- 存档不会从localhost自动迁移；原网址导出、新网址导入即可。
- 远端截图应与上线版本对应，历史截图在演示说明中另行标明。

## 本次发布验证

日期：2026-11-17（北京时间）。

- 状态：GitHub Actions 构建与部署均为 success；公开网址 HTTP 200，标题为「镜海 · Mirror Coast」。
- 首次部署的游戏提交：[18d2103](https://github.com/yydshly/mirror-coast-web/commit/18d2103156a4f6433ffb7b6a6f6a93cffba633a9)。
- 流水线：[Checks and GitHub Pages](https://github.com/yydshly/mirror-coast-web/actions/runs/44012297384)。
- 远端全新 npm ci 成功；100个测试文件／649项测试通过，测试约131.47秒，Vite构建约0.50秒。
- 本地同一发布副本的649项测试及TypeScript／生产构建通过。
- 独立临时Edge、1280×800视口，实际加载远端3D场景；按钮进入步行，W前进约2.48米。
- 原生导出存档、刷新、再次导出后，步行模式与玩家坐标恢复一致；本次样本没有体素编辑。
- 本次浏览器检查未发现页面未处理异常、失败请求或控制台警告。该结论仅限这段检查。
- 本次没有重新跑十五分钟整路线、重破坏、全部载具或移动端验收；历史慢帧问题仍在README列明。
- 源码、测试及public素材与原工程逐文件哈希一致；发布相关差异为相对资源路径、文档、演示与部署配置。原工程文件未改动。

线上截图在 [DEMO.md](DEMO.md)。后续仅更新README、说明和图片的提交可使用GitHub认可的 `[skip ci]` 标记，避免重复构建同一份游戏；代码和工作流变化仍必须完整检查。

## 更新与回退

后续以本仓库main为发布来源，提交前运行相关检查并构建。回退使用一个新提交恢复到已知可用版本，再由同一流水线发布；不强制改写远端历史。

如果原型工程继续开发，先明确选择需要同步的文件，再带着差异移入本仓库。不要把node_modules、dist、开发artifacts、存档、凭据或本机绝对路径混入提交。

