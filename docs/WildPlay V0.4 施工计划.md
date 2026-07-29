# WildPlay V0.4 音频播放施工计划

状态：进行中

日期：2026-07-30

## 阶段 1：格式与 Handler

- 把 MP3、FLAC、MP4/M4A、ADTS/AAC、OGG、WAVE 加入输入格式；
- 增加 `audio-player` Handler；
- 更新应用版本与说明；
- 增加音频探测单元测试。

## 阶段 2：纯音频界面

- 增加音频舞台和媒体摘要；
- 隐藏纯音频模式下的视频 Canvas、字幕覆盖层和字幕菜单；
- 保留多音轨菜单、播放控制、Seek、音量和全屏；
- 保持切换资源时旧 session 只释放一次。

## 阶段 3：验证

- 运行完整测试、类型检查、构建和协议逐字校验；
- 回归 MP4、WebM、MKV、字幕和音轨选择；
- 在真实 Biunivers 中测试至少 MP3、FLAC、M4A、OGG/Opus 和 WAV；
- 验证长音频 Seek、续租、切换文件和宿主重启失效。

## 自动验证记录

- Vitest：22 项通过；
- TypeScript 严格检查和生产构建通过；
- Manifest 与 Handler Schema 通过；
- 三份协议原文与宿主开发包逐字一致；
- Chrome 模拟 Resource Session/Range 验证：
  MP3、FLAC、M4A、AAC/ADTS、OGG/Vorbis、OGG/Opus、WAV、MKA 均完成探测；
- MP3、AAC、Vorbis 和 Opus 已在自动浏览器测试中实际开始播放；
- AAC 与 OGG 缺少快速时长元数据时，已验证精确时长回退。
