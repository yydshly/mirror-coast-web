# WebGL 启动失败与存档保护

城市需要 WebGL 2。HTML、按钮和文字能显示，并不表示浏览器已成功创建图形环境；图形加速开关开启时，GPU 进程也可能因崩溃或限制而不可用。

启动失败时显示独立的恢复页面，替换不可使用的游戏控件。页面提供重新加载、错误信息复制、图形加速设置路径、完整重启浏览器的方法和 GPU 诊断指引。只重试当前页面，不会自动重启浏览器或修改系统设置。

1. 点击「重新尝试加载」。这会保留当前网址中的旅程参数。
2. 若仍失败，Edge 在地址栏输入 `edge://settings/system`，Chrome 使用 `chrome://settings/system`，确认图形加速开启。
3. 开关已开但仍无画面时，先保存其他网页未提交内容，再完整重启浏览器。Edge 可输入 `edge://restart`，Chrome 使用 `chrome://restart`。这会重新加载该浏览器的全部标签页；后台运行或启动增强可能让“只关窗口”不能真正结束进程。
4. 若仍失败，在 `edge://gpu` 或 `chrome://gpu` 查看 WebGL 状态，提供「Graphics Feature Status」和「Problems Detected」两段，以及恢复页里的启动错误。不要直接发送包含本机路径等内容的整份诊断报告。

网页无法自行解除浏览器对 WebGL 的禁用。不要为了此类错误清理站点数据或重置世界，那会影响本地存档，也无法修复浏览器的图形进程。

图形环境创建发生在 `WorldPersistence` 初始化之前。该失败分支直接结束启动，不打开、删除或重建存档数据库；复制的信息仅包含启动错误与图形创建错误，不包含世界数据。后续其他启动异常也使用错误页面，但不会声称尚未读取存档。

参考：[Microsoft Edge 图形加速设置](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/hardwareaccelerationmodeenabled)、[Canvas 图形环境创建规则](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext)。

## 内置浏览器实测

本地未发布的测试页拦截 WebGL 2 创建，执行真实的游戏入口，而不是单独展示错误组件：

- 失败后显示恢复页、隐藏画布和游戏控件；存档数据库打开次数 0、删除次数 0。
- 「复制错误信息」正常反馈，不含存档正文。
- 模拟图形恢复后点击重新加载，旅程参数保持，进入同一独立测试旅程；数据库正常打开 1 次、删除次数仍为 0。
- 同时检查了正常渲染、旧城步行近景以及建筑顶部支撑和碰撞。

本轮只操作内置浏览器中的独立测试页面，没有操作用户的桌面、Edge 窗口或游戏存档。

![模拟 WebGL 不可用时显示的恢复页面](demo/webgl-recovery.jpg)
