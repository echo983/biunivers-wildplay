# WildPlay V0.1 需求与技术设计

状态：设计候选

日期：2026-07-29

## 1. 产品目标

用户在 Biunivers 文件管理器或桌面中双击一个视频文件，WildPlay 打开并开始播放。用户可以
播放、暂停、调整音量、拖动进度、切换全屏，并在长视频中多次 Seek，而不下载完整文件。

V0.1 面向当前 Biunivers 推荐环境：桌面版 Chrome、Chromium 或 Edge。

应用身份：

```text
repository: https://github.com/echo983/biunivers-wildplay
appId: io.github.echo983.biunivers-wildplay
name: WildPlay
version: 0.1.0
```

默认窗口建议为 `960 × 640`，最小窗口为 `560 × 360`。

## 2. 第一版范围

必须完成：

- 注册 `.mp4`、`.webm` 和 `.mkv` 的 `open` Handler；
- 通过 `resource.claimLaunch` 领取启动资源；
- 通过 `resource.open` 主动选择媒体；
- 每 60 秒续租，关闭或切换时主动释放；
- 使用单区间 HTTP Range 按需读取；
- 显示文件名、容器、时长、分辨率、视频和音频 codec；
- 播放/暂停、进度、Seek、音量、静音和全屏；
- 加载、缓冲、格式不支持、codec 不支持和会话失效提示；
- 同一个文件连续多次 Seek 不完整下载。

V0.1 不做：

- 媒体库、目录枚举或播放历史；
- 播放列表；
- 字幕选择、音轨选择和章节；
- 网络 URL；
- 转码、截图或导出；
- DRM；
- 手机端手势；
- 依赖 SharedArrayBuffer 的多线程 ffmpeg.wasm；
- 为不受浏览器支持的 codec 做软件解码兜底。

## 3. 已验证的浏览器边界

Resource Session 的内容 URL 要求 `Authorization` 和
`Biunivers-Resource-Session` 请求头，不能直接赋给 `<video src>`。

Media Source Extensions 接受的是带初始化段和媒体段语义的字节流，不是任意文件 Range。
因此把普通 MP4 或 MKV 的任意切片直接 `appendBuffer` 不构成可靠播放器。

WebCodecs 负责解码编码后的音视频 chunk，但不负责 MP4、WebM 或 MKV 容器 demux。播放器
仍必须解析容器、定位关键帧并把带时间戳的 packet 交给解码器。

结论：WildPlay 必须有明确的随机访问数据源和 demux 层，不能用 Blob 全量下载或“Range
直接喂 video”绕过。

## 4. 技术路线

V0.1 推荐使用 Mediabunny 作为 Web 原生 demux 与解码适配层：

- `CustomSource.getSize()` 映射 Resource Session metadata size；
- `CustomSource.read(start, end)` 映射
  `Range: bytes=start-(end-1)`；
- `prefetchProfile: "network"` 降低高延迟下的小请求数量；
- Input 只启用 MP4、Matroska/WebM 格式，避免打入无关解析器；
- 通过 Input/Track API 读取容器、轨道和 codec 元数据；
- 通过基于 WebCodecs 的 sink 解码视频与音频。

Mediabunny 的随机读取接口与 Resource Session 区间语义精确对应，不需要把宿主能力转换成
临时 URL，也不需要完整文件缓存。

ffmpeg.wasm 不进入 V0.1 基础路径：

- 它解决的是 FFmpeg 能力移植，不会自动解决按需 Range、播放器时钟和 UI 状态；
- 多线程核心需要 SharedArrayBuffer/cross-origin isolation；
- 单线程完整核心仍有明显下载、内存与 CPU 成本；
- 当前 Biunivers 没有为第三方 app 承诺 cross-origin isolation。

未来只有在收集到明确的“不受 WebCodecs 支持但值得软件解码”的 codec 后，才增加裁剪过的
WASM decoder；不先引入完整 ffmpeg.wasm。

## 5. 组件结构

```text
Biunivers Resource Session
          │
          ▼
ResourceSessionClient
  claim/open/renew/release
          │
          ▼
ResourceRangeSource
  getSize + read(start,end)
          │
          ▼
Mediabunny Input / demux
  MP4 · WebM · Matroska
          │
          ▼
PlaybackEngine
  WebCodecs video/audio sinks
          │
          ├── PlaybackClock
          ├── BufferController
          └── SeekController
                  │
                  ▼
          Canvas + Web Audio
```

UI 只调用 `PlaybackEngine`，不直接 fetch，不保存 session token，也不理解容器结构。

## 6. 资源读取

`ResourceRangeSource` 接收公开 session 描述并实现：

```ts
interface RandomAccessSource {
  readonly size: number;
  read(start: number, endExclusive: number): Promise<Uint8Array>;
  close(): Promise<void>;
}
```

约束：

- 严格校验 `0 <= start < endExclusive <= size`；
- HTTP Range 结束位置为 `endExclusive - 1`；
- 要求 206、准确 `Content-Range` 和准确响应体长度；
- 对相同在途 Range 去重；
- 最多 4 个并发读取；
- AbortSignal 取消过时 Seek；
- 第一版只使用 Mediabunny 自带的有限缓存，不另造磁盘缓存；
- 不在日志中输出实例 token 或 session ID。

## 7. 播放与 Seek

播放时钟由音频时钟优先驱动；无音轨时使用高精度单调时钟。视频帧根据 timestamp 显示，
过晚帧允许丢弃。

Seek 流程：

1. 递增 seek generation；
2. 取消旧 generation 尚未完成的 Range；
3. 由 demux 层定位目标时间之前最近关键帧；
4. 清空旧 decoder queue 和待显示帧；
5. 从关键帧重新解码；
6. 音视频达到目标时间后恢复播放或保持暂停。

拖动进度时只保留最后一个目标；不为每个 pointer move 发起完整 Seek。

## 8. 状态机

```text
idle
  └─ open → probing
               ├─ unsupported → error
               └─ ready → paused ↔ playing
                              │
                              ├─ seek → seeking → paused/playing
                              ├─ underflow → buffering → playing
                              └─ session lost → error
```

切换资源先停止 engine，再释放旧 session。组件卸载同样清理 decoder、音频上下文、Range
请求和续租集合。

## 9. 失败语义

- 容器不能识别：提示“不支持的媒体容器”；
- codec 不能由浏览器解码：显示准确 codec，不伪装成网络错误；
- 401/403/404/410：停止播放并提示重新打开文件；
- 416：视为读取实现错误，停止当前资源；
- 网络暂时失败：暂停并允许用户重试；
- 解码器错误：停止对应资源，释放 VideoFrame/AudioData；
- 内存压力：减少预取并清理远离播放头的缓存。

## 10. 安全和隐私

- 只接受来自父窗口和已知宿主 Origin 的协议消息；
- session 数据只保存在内存；
- 不向第三方 CDN 发送媒体字节或 metadata；
- npm 依赖必须随构建产物打包，运行时不从 CDN 加载脚本或 WASM；
- 应用仓库公开，但不包含媒体样本、凭据或用户数据。

## 11. 可行性结论

Resource Session 已提供大文件随机读取、重复 GET、租约和撤销；Mediabunny 提供与之匹配的
自定义随机 Source、MP4/Matroska/WebM demux 和 WebCodecs 接入。二者组合能够闭合 V0.1。

主要工程风险在音视频同步、Seek generation 清理和不同 codec 的浏览器支持，而不是文件
传输。第一阶段应先完成“真实资源探测 + Range 可观测”，再实现播放时钟，最后扩格式。

## 12. 设计参考

- [W3C Media Source Extensions](https://w3c.github.io/media-source/)：初始化段、媒体段和
  byte stream 的规范边界；
- [W3C WebCodecs](https://www.w3.org/TR/webcodecs/)：解码接口不处理容器；
- [Mediabunny input formats](https://mediabunny.dev/guide/input-formats)：MP4、WebM 和
  Matroska 输入支持；
- [Mediabunny CustomSource](https://mediabunny.dev/api/CustomSourceOptions)：随机读取
  `read(start, end)` 和网络预取模型；
- [ffmpeg.wasm overview](https://ffmpegwasm.netlify.app/docs/overview/)：单线程、多线程和
  自定义 core 的边界。
