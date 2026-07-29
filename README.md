# WildPlay

WildPlay 是面向 Biunivers 的纯静态媒体播放器。

目标是通过 `biunivers.resource-session/1` 按需读取个人文件，在浏览器中播放常见音视频
容器，并支持大文件、拖动进度和重复 Seek。

当前状态：V0.2 已完成 MP4/MKV 播放、Seek、音量、静音、全屏和 MKV 内封文本字幕，
并通过 Biunivers + Cloudflare R2 真实链路验收。在播放画面区域右键，可通过“字幕”子菜单
选择 UTF-8、ASS/SSA 或 WebVTT 文本字幕轨。图形字幕与完整 ASS 特效不在本版范围内。

V0.3 已完成 MP4、WebM 和 MKV 音轨选择。在播放画面区域右键，可通过“音轨”子菜单
查看名称、语言、codec 和声道数，并在保持当前播放位置的情况下切换可解码音轨。单音轨
真实 MKV 和双 AAC 音轨测试文件均已通过验收。

V0.4 增加 MP3、FLAC、M4A、AAC、OGG、Opus、WAV 和 MKA 音频文件。纯音频模式复用
播放、Seek、音量、多音轨和 Resource Session 管线，并提供独立音频舞台。

## 本地开发

```bash
npm install
npm test
npm run build
```

`npm run build` 会生成并更新根目录的 `index.html` 与 `assets/`。这些文件属于可安装的
静态应用包，需要随源码提交。

## 已确定的边界

- 应用包保持纯静态，不引入应用专属后端；
- 媒体内容只通过 Resource Session 获取；
- 不把宿主凭据、session ID 或文件内容持久化；
- 容器解析与随机读取优先使用 Web 原生友好的 demux 管线；
- 第一版不把完整媒体文件载入内存；
- ffmpeg.wasm 只作为未来不兼容 codec 的可选 fallback，不作为第一版基础播放器。

设计与施工文档见 [`docs/`](docs/)。
