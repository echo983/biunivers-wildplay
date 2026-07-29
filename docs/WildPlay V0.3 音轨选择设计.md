# WildPlay V0.3 音轨选择设计

状态：已完成，归档

日期：2026-07-29

## 目标

当媒体包含多条音轨时，用户可在播放画面的右键菜单中查看并切换音轨。切换保持当前播放
位置、播放或暂停状态、音量与静音状态，不重新打开 Resource Session。

## 最小范围

- MP4、WebM 和 MKV 共用 Mediabunny 公开音轨 API；
- 枚举名称、语言、codec、声道数、默认标记和可解码性；
- 右键菜单增加“音轨”子菜单；
- 单音轨也显示当前轨道，便于用户确认；
- 不可解码轨道显示但禁用；
- 切换时重建 Input 与 AudioBufferSink，从当前时间重新预缓冲；
- 切换失败时保留媒体会话并给出明确错误。

不做：

- 多音轨混音；
- 音频延迟校准；
- 声道映射、均衡器和响度归一化；
- 跨文件记忆语言偏好；
- 无缝切换承诺。

## 状态转换

```text
paused/playing
      │ select audio track
      ▼
switching
  ├── rebuild input + sinks
  ├── preserve position
  └── prime selected audio
      │
      ├── success → paused/playing
      └── failure → paused + error
```

切轨递增播放器 generation，旧音频节点淡出并停止，旧 iterator 和 Range 结果不得继续调度。
新 Input 通过音轨的 1-based audio track number 重新找到同一轨道；不依赖可能超过安全整数的
容器 Track UID。

音轨切换不调用共享 `ResourceRangeSource.cancelPending()`，避免中断字幕控制器正在进行的
Range 读取。旧播放器读取即使完成，也会因 generation 失效而不能继续调度音频。

## 交互

```text
音轨  >
  ● Japanese · ja · AAC · 2ch
    English · en · AAC · 2ch
    Commentary · en · Opus · 2ch

字幕  >
  ...
```

名称优先，语言用于消除重名。只有一条轨道时仍可查看，但重复选择当前轨道不触发重建。

## 闭环检查

- 输入：Resource Session 和现有随机 Range 足够；
- 枚举：Mediabunny 公开 `getAudioTracks()` 提供全部音轨；
- 选择：音轨序号在同一文件的新 Input 中稳定；
- 消费：现有 AudioBufferSink、Web Audio 调度和时钟可复用；
- 撤销：generation、停止 AudioBufferSourceNode、Input dispose；
- 恢复：保存切轨前位置和 playing 状态，成功后恢复；
- 失败：停止在当前位置，不释放文件会话，用户可再次选择。

因此无需新增宿主协议或容器旁路，逻辑闭环。

## 实施结果

实现使用 Mediabunny 的公开 `getAudioTracks()` 枚举轨道，以音频轨的 1-based `number`
作为 Input 重建后的稳定选择键。切轨保持播放位置、播放/暂停状态、音量和静音状态。

真实验收确认：

- 单音轨 MKV 的菜单显示正常；
- 双 AAC 音轨 MKV 可辨识名称、语言、codec 和声道数；
- 播放中切换保持位置并继续播放；
- 暂停时切换保持暂停；
- 两条不同频率音轨可以往返切换；
- 切轨不影响 Resource Session 和字幕旁路。
