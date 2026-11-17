# 依赖与素材来源

运行时依赖版本以package-lock.json为准：

| 依赖 | 当前锁定版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| Three.js | 0.187.0 | MIT | 浏览器3D渲染 |
| @dimforge/rapier3d-compat | 0.21.0 | Apache-2.0 | 刚体物理，兼容包内含WASM |

开发工具包括TypeScript、Vite、Vitest、@types/three、fake-indexeddb；具体依赖及传递依赖均保留锁文件。使用、修改或再分发依赖时遵守各自发布包中的许可和声明。

场景模型、布局和材质效果主要由本项目代码程序生成；演示截图来自本游戏实机。本次发布未复制Chatdom源码、模型、贴图、声音或宣传画面，也不包含真实地图／卫星影像数据。

