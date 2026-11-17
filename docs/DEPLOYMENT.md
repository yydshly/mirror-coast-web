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

本次实际构建、测试与线上检查的结果将在发布完成后记录于本文件。未完成项不计作通过。

## 更新与回退

后续以本仓库main为发布来源，提交前运行相关检查并构建。回退使用一个新提交恢复到已知可用版本，再由同一流水线发布；不强制改写远端历史。

如果原型工程继续开发，先明确选择需要同步的文件，再带着差异移入本仓库。不要把node_modules、dist、开发artifacts、存档、凭据或本机绝对路径混入提交。

