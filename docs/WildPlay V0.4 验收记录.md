# WildPlay V0.4 验收记录

状态：通过，归档

日期：2026-07-30

## 自动校验

- `npm test`：5 个测试文件、22 项测试通过；
- `npm run lint`：TypeScript 严格检查通过；
- `npm run build`：生产构建和根目录静态包发布通过；
- Manifest 与 Handler Schema 校验通过；
- 三份 Biunivers 协议原文与宿主开发包逐字一致。

Chrome 模拟 Resource Session 和 HTTP Range 的测试覆盖 MP3、FLAC、M4A、AAC/ADTS、
OGG/Vorbis、OGG/Opus、WAV 与 MKA 的探测。MP3、AAC、Vorbis 和 Opus 还实际进入播放
状态；AAC 与 OGG 缺少快速时长元数据时，会回退到精确时长计算。

## 人工验收

在真实 Biunivers 宿主中测试 MP3 和 FLAC：

- 能通过 WildPlay Handler 打开；
- 音频模式、媒体摘要和控制界面正常；
- 播放、暂停、音量、静音与 Seek 正常；
- 未破坏原有视频播放路径。

测试媒体属于用户本地文件，不属于应用源码或发布包，未提交到 Git。

## 已知边界

- 不保证浏览器能够解码首版容器中的任意 codec；
- 不读取封面图，不编辑媒体标签，不提供播放列表；
- 不自动播放，首次播放仍需用户手势；
- M4A、AAC、OGG、Opus、WAV 与 MKA 已完成自动验证，但本里程碑未逐一进行真实宿主人工验收。

## 结论

WildPlay V0.4 已形成音频文件注册、资源领取、Range 读取、探测、播放、Seek、续租与释放
的完整路径。MP3 和 FLAC 的真实宿主验收通过，视频能力保持兼容，具备合并条件。
