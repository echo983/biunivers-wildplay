# WildPlay

WildPlay 是面向 Biunivers 的纯静态媒体播放器。

目标是通过 `biunivers.resource-session/1` 按需读取个人文件，在浏览器中播放 MP4、
WebM 和 MKV，并支持大文件、拖动进度和重复 Seek。

当前状态：V0.1 已完成 MP4 容器探测、基础播放、真实预缓冲、Seek、音量、静音和全屏，
并通过 Biunivers + Cloudflare R2 真实链路首轮验收。MP4 和 MKV 已完成真实播放与 Seek
验收；WebM 保持协议与实现支持，但不作为 V0.1 人工验收门槛。

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
