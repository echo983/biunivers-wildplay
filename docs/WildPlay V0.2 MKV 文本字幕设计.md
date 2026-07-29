# WildPlay V0.2 MKV 文本字幕设计

状态：已完成，归档

日期：2026-07-29

## 1. 目标

在不改变 V0.1 音视频播放链路的前提下，为 MKV 增加内封文本字幕：

- 识别可用字幕轨；
- 在播放画面的右键菜单中选择字幕或关闭字幕；
- 按当前播放位置加载字幕，不完整下载媒体；
- Seek 后尽快显示新位置字幕，不显示旧请求返回的内容；
- 全屏和窗口模式使用同一字幕叠加层。

字幕默认关闭。用户明确选择后才读取字幕块。

## 2. 第一版支持范围

支持：

- `S_TEXT/UTF8`；
- `S_TEXT/ASS` 和 `S_TEXT/SSA` 的可读文本降级；
- `S_TEXT/WEBVTT` 的 cue 文本；
- Track 名称、语言和默认轨标记；
- `SimpleBlock`；
- `BlockGroup + BlockDuration`；
- Segment 和 Track 时间缩放；
- 无 `BlockDuration` 时，以同轨下一条字幕的开始时间作为结束时间。

明确不支持：

- `S_HDMV/PGS`、VobSub 等图形字幕；
- ASS/SSA 字体附件、定位、动画、卡拉 OK 和复杂特效；
- WebVTT 的区域、样式和 cue settings；
- 有 lacing 的字幕块；
- 加密内容；
- 无任何可用 Cue、必须顺序扫描整个文件才能定位的字幕。

ASS/SSA 首版保留可读文本，处理 `\N`/`\n` 换行并去掉 `{...}` override tag。它不是完整
ASS 渲染器。

## 3. 为什么不扩展当前媒体库

WildPlay 固定使用的 Mediabunny 1.51.0 公开输入 API 只暴露视频轨和音频轨，没有字幕输入轨、
字幕 sink 或 cue 读取接口。直接改造依赖会把工作扩大到公共 API、Matroska demux、缓存和
发布维护。

因此 V0.2 在同一个 `ResourceRangeSource` 上增加独立、只读的 Matroska 字幕解析器。现有
Mediabunny 继续负责音视频；字幕解析失败不得破坏视频播放。

## 4. 随机访问路径

```text
ResourceRangeSource
        │
        ├── Mediabunny ── 音视频播放
        │
        └── MatroskaSubtitleSource
                ├── EBML / Segment
                ├── SeekHead / Tracks / Cues
                ├── Cluster / Block
                └── SubtitleController ── DOM 字幕层
```

打开文件时只读取容器头和索引窗口：

1. 验证 EBML DocType 为 `matroska` 或 `webm`；
2. 找到 Segment；
3. 从 SeekHead 定位 Tracks 和 Cues；
4. 解析文本字幕 Track；
5. 建立 `time → cluster position` 索引。

字幕轨有自己的 Cue 时直接使用。没有字幕 Cue 时，可以使用视频或其他轨 Cue 定位覆盖当前
时间的 Cluster，并在 Cluster 中筛选字幕 Track。完全没有可用 Cue 时，该字幕轨标记为
“缺少可随机访问索引”，不进行全文件扫描。

一次只加载播放头附近的有限时间窗。读取以 Cluster 边界为单位，并设置单次字节上限；超限或
格式异常时报字幕错误，视频继续播放。

## 5. 时间与 cue

字幕开始时间：

```text
(Cluster.Timestamp + Block.relativeTimestamp)
× Segment.TimestampScale
× Track.TimestampScale
```

结果统一换算为秒。

结束时间按以下顺序确定：

1. `BlockDuration`；
2. 同轨下一条字幕开始时间；
3. 保守的默认展示时长，并设最大展示时长。

切轨和 Seek 都递增 subtitle generation。旧 generation 的读取即使稍后返回，也不能写入
当前 cue 集合。

## 6. 交互

播放器只拦截视频画面区域的右键菜单：

```text
字幕  >
  ● 关闭
    中文（简体）
    English
    Commentary
```

菜单项优先显示 Track 名称；其次显示标准化语言；最后显示“字幕 1”。不可解析的图形字幕不
出现在可选项中。

选择字幕后立即从当前位置加载。选择“关闭”会取消读取、清空画面字幕，但不释放媒体资源会话，
因为音视频仍在使用它。

## 7. 安全与鲁棒性

- 所有 EBML 长度、位置和整数必须检查安全整数与文件边界；
- 未知尺寸只在规范允许的容器层接受；
- 不分配由媒体文件直接声明的超大缓冲；
- UTF-8 使用容错解码，格式错误不得导致主播放器崩溃；
- 不执行 ASS/SSA 内容，不把字幕作为 HTML 插入；
- 只用 `textContent`/文本节点显示字幕；
- 解析器不记录 Resource Session 凭据。

## 8. 验收

- 无字幕 MP4、WebM、MKV 的 V0.1 行为不回归；
- 带一个 UTF-8 字幕轨的 MKV 可以选择、显示、关闭；
- 带多个文本字幕轨的 MKV 可以切换；
- ASS 的正文和换行可读，样式标签不显示；
- Seek 后不闪回旧位置字幕；
- 字幕读取使用 Range，未完整下载文件；
- 不支持的图形字幕不影响播放；
- 损坏字幕索引只显示字幕错误，不终止音视频。

## 9. 规范依据

- RFC 9559（Matroska）：EBML 结构、Block、BlockDuration、Cues 和随机访问语义；
- IETF Matroska Codec Specifications：`S_TEXT/UTF8`、`S_TEXT/ASS`、
  `S_TEXT/SSA` 和 `S_TEXT/WEBVTT` 的载荷约定；
- Mediabunny 1.51.0 的公开类型声明：当前输入轨 API 边界。

## 10. 实现后说明

真实 MKV 验收发现 `TrackUID` 可能是超过 JavaScript 安全整数范围的 64 位值。该字段不是
字幕选择、定位或读取所需字段，最终实现不解析它；TrackNumber、时间、元素长度和文件位置
仍执行严格边界检查。

字幕窗口最终采用当前位置附近 12 秒的有限预取。多个 Cluster 通过共享
`ResourceRangeSource` 并发读取，仍受全局 4 并发限制。播放位置发生明显跳变时立即递增
subtitle generation、清空旧 cue 并重新定位，避免 Seek 后等待旧窗口或显示旧字幕。
