# WildPlay V0.1 规范评审

状态：通过

日期：2026-07-29

## 结论

V0.1 只实现一条播放主线：

```text
Resource Session Range
→ Mediabunny CustomSource / demux
→ WebCodecs
→ Canvas + Web Audio
```

这条主线具备必要性、可实现性和可测试性。以下内容从第一版删除：

- 完整 ffmpeg.wasm；
- MSE 与 WebCodecs 双播放引擎；
- 软件 codec fallback；
- 字幕、音轨选择、章节和播放列表；
- 媒体库、历史和目录枚举；
- 转码与导出。

## 必要性判断

### Resource Session：必须

宿主内容 URL 需要自定义凭据头，且大文件必须按需读取。Resource Session 已验证单区间
Range、重复 Seek、续租和撤销，是 WildPlay 的唯一资源入口。

### demux：必须

WebCodecs 不解析 MP4、WebM 或 MKV 容器。播放器需要容器元数据、packet timestamp 和关键帧
位置，因此必须有 demux 层。

### Mediabunny：采用

其 `CustomSource.read(start, end)` 与 Resource Session Range 精确对应；支持所需三种容器，
并提供 WebCodecs sink。相比自行实现三种容器解析，依赖更小、风险更低。

固定版本：`mediabunny@1.51.0`，许可证 `MPL-2.0`。应用自身继续使用 MIT；发行包保留第三方
许可证声明。

### ffmpeg.wasm：暂缓

第一版的核心问题是随机读取、demux、同步和 Seek，不是转码。完整 ffmpeg.wasm 会引入较大
下载、内存、CPU 和 cross-origin isolation 决策，却不消除播放器时钟与资源生命周期工作。
只有真实 codec 矩阵证明存在高价值缺口后，才评审裁剪 decoder。

## 风险收敛

- 不承诺“所有 MKV 都能播”；容器支持与 codec 支持分开报告；
- V0.1 只承诺当前浏览器 `VideoDecoder.isConfigSupported` /
  `AudioDecoder.isConfigSupported` 接受的 codec；
- 不完整下载是合并门槛，不是优化项；
- 音视频同步和 Seek generation 是阶段 3/4 的主要验收对象；
- 阶段 2 先完成真实媒体探测，若 Mediabunny 与 Resource Session 的 Range 组合不成立，
  在编写播放时钟前停止并重新评审。

## 施工批准

阶段 0—2 可以施工。阶段 3 基础播放必须在真实 MP4、WebM、MKV 探测通过后开始。
