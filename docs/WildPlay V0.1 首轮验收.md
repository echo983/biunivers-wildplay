# WildPlay V0.1 首轮验收

- 日期：2026-07-29
- 结果：MP4 主链路通过
- WildPlay 分支：`design/v0.1-playback-pipeline`
- Biunivers 宿主分支：`fix/iframe-fullscreen-permission`
- 存储：Cloudflare R2 S3 兼容对象存储

## 已验证链路

1. Biunivers 从公开 GitHub 仓库安装并更新 WildPlay 静态应用；
2. 文件管理器把 MP4 作为 Open Resource 交给 WildPlay；
3. WildPlay 通过 Resource Session 领取资源，并按需执行带凭据的单区间 Range GET；
4. Mediabunny CustomSource 解析 MP4 容器并报告时长、分辨率和音视频 codec；
5. 用户明确点击后启动 Web Audio，预解码首帧并预缓冲约 1.5 秒音频；
6. Canvas 视频、Web Audio 主时钟、播放、暂停、音量和静音可用；
7. 播放态和暂停态前后 Seek 行为正确；
8. 连续 Seek 不显示旧 generation 帧，不残留旧位置声音；
9. 解码落后时丢弃完全过期音频块和视频帧，不再追赶播放或产生爆音；
10. 播放态 Seek 复用首个已解码目标帧，不重复解码同一关键帧区间；
11. 宿主把逻辑 Range 精确下推为 S3 `GetObject Range`，不再完整下载相交的 64 MiB Chunk；
12. 全屏开关可用，控制条静置后自动隐藏，移动指针后恢复，且不产生滚动条。

## 验收中发现并修复

- 原生 `fetch` 脱离 Window 调用导致 `Illegal invocation`；
- iframe 未获得 fullscreen 权限；
- 浏览器禁止 iframe 中无用户手势启动 Web Audio，因此取消自动播放；
- 旧 decoder/sink 在 Seek 后继续工作，造成卡顿和爆音；
- 落后音频块被同时安排到当前时间，造成叠音；
- 首次播放只有名义缓冲，时钟早于音频预解码启动；
- Seek 对目标关键帧区间重复解码；
- 宿主虽然向应用提供 HTTP Range，但对象仓库仍完整读取 64 MiB Chunk；
- 全屏控制条移出视口时触发横纵滚动条。

## 尚未完成

- WebM 和 MKV 真实样本；
- codec/browser 支持矩阵；
- 键盘快捷键；
- 多小时连续播放、会话续租和网络故障注入；
- V0.1 tag。

这些项目不否定 MP4 点播主链路的可用性，但应在正式宣称 WebM/MKV 支持或发布 V0.1
里程碑前完成。
