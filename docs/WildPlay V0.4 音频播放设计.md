# WildPlay V0.4 音频播放设计

状态：施工基线

日期：2026-07-30

## 目标

在保持 WildPlay 视频、字幕、音轨选择和 Resource Session 行为不变的前提下，增加常见
音频文件的打开与播放能力。

## 首版格式

| 扩展名 | 解封装器 | 常见编码 |
|---|---|---|
| `.mp3` | Mediabunny MP3 | MP3 |
| `.flac` | Mediabunny FLAC | FLAC |
| `.m4a` | Mediabunny MP4 | AAC、ALAC |
| `.aac` | Mediabunny ADTS | AAC |
| `.ogg`、`.oga`、`.opus` | Mediabunny OGG | Vorbis、Opus、FLAC |
| `.wav` | Mediabunny WAVE | PCM 及浏览器支持的 WAVE 编码 |
| `.mka` | Mediabunny Matroska | Opus、Vorbis、AAC、FLAC 等 |

Handler 声明表示 WildPlay 能识别容器，不承诺当前浏览器能解码容器中的任意编码。每个音轨
仍通过 `track.canDecode()` 检测，不能解码时给出明确提示。

## 产品行为

- 视频和音频共用“打开媒体”、播放、暂停、时间轴、音量、静音、Seek 和 Resource Session；
- 纯音频模式不显示黑色视频 Canvas 和字幕入口；
- 舞台显示文件名、容器、codec、声道数和采样率；
- 多音轨音频仍可通过右键菜单切换音轨；
- 不读取封面图、不编辑标签、不建立播放列表；
- 不自动播放，继续遵守浏览器用户手势要求；
- 不引入 ffmpeg.wasm 或新的应用后端。

## 安全与生命周期

- 应用只能读取宿主交付或用户选择的单个媒体资源；
- 音频与视频统一使用单区间 Range，不完整下载大文件；
- session 约每 60 秒续租，切换文件和关闭页面时释放；
- 不持久化 session、实例凭据、内容 URL 或媒体内容；
- 新增独立稳定 Handler `audio-player`，保留既有 `video-player` 身份。
