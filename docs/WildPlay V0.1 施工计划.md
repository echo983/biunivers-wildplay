# WildPlay V0.1 施工计划

状态：阶段 0—1 完成，阶段 2 施工中

## 阶段 0：协议与包基线

- 固定 app ID、窗口尺寸和 Handler；
- 放入 Biunivers Static App、Open Resource 和 Resource Session 三份协议原文；
- 建立 Vite + TypeScript 静态构建；
- 固定依赖版本和许可证清单；
- 验证根目录 `index.html` 及所有构建资源使用相对路径，可被宿主直接提供。

## 阶段 1：Resource Session 客户端

- 严格 postMessage parser、Origin/source 校验和请求关联；
- claimLaunch、open、renew 和 release；
- Range GET 与响应头校验；
- in-flight 去重、并发上限和 AbortSignal；
- 客户端单元测试。

出口：能对真实媒体显示文件大小，并执行任意区间的逐字节验证。

## 阶段 2：容器与 codec 探测

- 接入 Mediabunny CustomSource；
- 仅打包 MP4、Matroska 和 WebM 输入；
- 显示时长、分辨率、轨道与 codec；
- 容器/codec 不支持错误。

出口：用真实 MP4、WebM、MKV 证明探测不完整下载。

## 阶段 3：基础播放

- 视频 sink、Canvas 呈现和帧释放；
- 音频 sink、Web Audio 调度和主时钟；
- 播放、暂停、音量、静音；
- 缓冲与错误状态；
- 后台窗口暂停策略。

出口：至少一种 MP4/H.264/AAC 样本稳定播放十分钟，音画同步可接受。

## 阶段 4：Seek 与格式扩展

- 关键帧 Seek；
- generation 取消与 decoder flush；
- 进度拖动合并；
- WebM 与 MKV 容器实测；
- 浏览器支持 codec 矩阵。

出口：在大文件中连续前后拖动，不完整下载且不播放旧 Seek 的帧。

## 阶段 5：产品验收

- 控件、键盘快捷键、全屏和响应式窗口；
- 会话续租、过期、停用、更新和重启；
- 资源切换与内存清理；
- Docker + R2 真实验收；
- 开发者文档、归档和 V0.1 tag。

## 合并门槛

- 媒体字节只来自 Resource Session；
- 不持久化 capability；
- 不完整下载大文件；
- Range 与 session 不进入 URL；
- Seek 可取消且不会显示旧 generation 帧；
- 所有 VideoFrame、AudioData、AudioContext 和 session 有确定释放路径；
- 不支持的 codec 给出明确错误；
- 无 cross-origin isolation 时仍能运行基础路径；
- 没有媒体内容或凭据进入仓库和日志。
