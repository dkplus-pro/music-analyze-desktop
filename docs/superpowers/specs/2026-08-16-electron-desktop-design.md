# Music Analyze Electron 桌面版设计

## 目标

把现有音乐分析管理后台变成可打包运行的 Electron 桌面应用。桌面端从本地文件选择器获取绝对路径，数据库永久记录源文件路径，分析和重试直接读取源文件，不上传、不复制、不删除源文件。原有浏览器上传模式继续兼容。

桌面端必须提供：

- 左侧菜单：`音乐分析`、`系统设置`；
- `音乐分析`页复用现有音乐资料库、导入、批量分析和详情功能；
- `系统设置`页编辑 AI 模型配置和飞书授权配置；
- `.env` 中已有的 AI 配置可被服务读取并在设置页展示（API Key 脱敏）；
- Electron 开发环境和打包环境均支持 F12 打开 DevTools；
- 使用 `tests/sample` 中的音频完成真实导入和分析链路测试。

## 架构

Electron 主进程负责窗口、文件选择器、DevTools 和本地 Node 服务生命周期。Renderer 继续使用 React/Vite 管理后台，通过 preload 暴露最小 IPC API：选择音频文件、选择文件夹、读取桌面运行信息。文件绝对路径只发送给本地 Node API，不进入远程网络。

本地 Node 服务增加 `sourceMode`：

- `MANAGED_COPY`：浏览器 multipart 上传继续写入临时文件，复制到管理目录，分析完成后删除管理副本；
- `LINKED_SOURCE`：Electron 传入绝对路径，校验文件存在、计算哈希和读取元数据，数据库的 `managedPath` 与 `sourcePath` 相同，分析队列直接读取 `sourcePath`，任何成功、失败、删除音乐记录的流程都不得删除该路径。

数据库保留 `source_path` 和 `managed_path` 字段以兼容已有数据；Linked 记录通过路径相等识别，不新增不必要的迁移表。所有“源是否可用”检查改为使用统一的 `analysisFilePath(track)`。

设置通过本地 API 读写 `.env` 配置对应的安全字段。AI Key 只返回是否已配置和末尾脱敏值；保存时不允许空值覆盖已有 key。飞书 App ID、App Secret、App Token、Table ID 支持脱敏读取和显式保存。服务启动时仍优先读取环境变量，设置页保存后需要重启服务的字段明确提示。

Electron 打包使用 `electron-builder`，打包前构建 admin、contracts、database、music-domain、node-service 和 desktop main/preload。桌面服务以本地子进程方式启动，使用 app userData 作为 SQLite 与运行时数据目录，开发环境仍允许 `.env` 中的 `DATABASE_URL`、`MUSIC_STORAGE_PATH`、`PORT` 覆盖。

## 错误处理与安全边界

- 文件路径必须是绝对路径，且扩展名为 MP3/WAV/FLAC/M4A/AAC/OGG；不存在、不可读、格式不支持的文件逐项显示失败原因。
- 源文件被移动或删除时，分析、重试、批量分析返回“源文件不可用”，不得创建或删除替代副本。
- Electron 仅开启 `contextIsolation`，关闭 renderer Node 集成；preload 只暴露白名单函数。
- `webSecurity` 保持开启，API 只监听 `127.0.0.1`。
- 开发环境和正式包都注册 `before-input-event` 的 F12 快捷键，切换 DevTools。

## 测试与验收

- Node 单元测试覆盖 Linked 导入不复制、源文件存在、分析失败/成功均不删除源文件、重试直接读取源文件。
- API 测试覆盖 JSON Linked 导入及源文件保留。
- React 测试覆盖左侧菜单切换、系统设置加载/保存、桌面文件选择桥接调用。
- Playwright Electron 测试启动打包前的 Electron 主进程，选择 `tests/sample/10 希望.mp3`，确认音乐被导入并完成至少一次真实分析；测试结束确认源文件仍存在。
- `electron-builder --dir` 产物启动后，健康检查、UI、F12 DevTools 和分析链路均验证通过。
