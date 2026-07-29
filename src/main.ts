import "./style.css";
import {
  createMediaInput,
  formatProbeInfo,
  probeMedia,
  type ProbedMedia,
  type AudioTrackProbeInfo,
} from "./media/probe";
import { MediaPlayer } from "./media/player";
import { ResourceSessionClient } from "./resourceSession/client";
import { ResourceRangeSource } from "./resourceSession/rangeSource";
import {
  ResourceSessionError,
  type ResourceSession,
} from "./resourceSession/types";
import { SubtitleController } from "./subtitles/controller";
import type { MatroskaSubtitleTrack } from "./subtitles/matroska";

const openButton = requireElement<HTMLButtonElement>("open-file");
const playButton = requireElement<HTMLButtonElement>("play-pause");
const muteButton = requireElement<HTMLButtonElement>("mute");
const volume = requireElement<HTMLInputElement>("volume");
const timeline = requireElement<HTMLInputElement>("timeline");
const time = requireElement<HTMLSpanElement>("time");
const canvas = requireElement<HTMLCanvasElement>("video-canvas");
const stage = document.querySelector<HTMLElement>(".stage");
if (!stage) throw new Error("Missing .stage");
const subtitleOverlay = requireElement<HTMLDivElement>("subtitle-overlay");
const contextMenu = requireElement<HTMLDivElement>("context-menu");
const audioMenuTrigger =
  requireElement<HTMLButtonElement>("audio-menu-trigger");
const audioMenu = requireElement<HTMLDivElement>("audio-menu");
const subtitleMenuTrigger =
  requireElement<HTMLButtonElement>("subtitle-menu-trigger");
const subtitleMenu = requireElement<HTMLDivElement>("subtitle-menu");
const emptyState = requireElement<HTMLDivElement>("empty-state");
const playbackHint = requireElement<HTMLButtonElement>("playback-hint");
const fullscreenButton = requireElement<HTMLButtonElement>("fullscreen");
const status = requireElement<HTMLSpanElement>("status");
const filename = requireElement<HTMLSpanElement>("filename");
const mediaInfo = requireElement<HTMLSpanElement>("media-info");
const client = new ResourceSessionClient();
let current:
  | {
      session: ResourceSession;
      source: ResourceRangeSource;
      media: ProbedMedia;
      player: MediaPlayer;
      subtitles: SubtitleController;
    }
  | undefined;
let opening = false;
let scrubbing = false;
let fullscreenControlsTimer: number | undefined;
let subtitleTracks: readonly MatroskaSubtitleTrack[] = [];

openButton.addEventListener("click", () => {
  void runOpen(async () => await client.open());
});

fullscreenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch (error) {
    showError(error);
  }
});

document.addEventListener("fullscreenchange", () => {
  const fullscreen = document.fullscreenElement !== null;
  fullscreenButton.textContent = fullscreen ? "退出全屏" : "全屏";
  document.documentElement.classList.toggle("is-fullscreen", fullscreen);
  if (fullscreen) showFullscreenControls();
  else clearFullscreenControlsTimer();
});

document.addEventListener("pointermove", () => {
  if (document.fullscreenElement) showFullscreenControls();
});

document.addEventListener("pointerdown", () => {
  closeContextMenu();
  if (document.fullscreenElement) showFullscreenControls();
});

stage.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  openContextMenu(event.clientX, event.clientY);
});

contextMenu.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
});

subtitleMenuTrigger.addEventListener("pointerenter", () => {
  showSubmenu(subtitleMenuTrigger, subtitleMenu);
  audioMenu.hidden = true;
});

audioMenuTrigger.addEventListener("pointerenter", () => {
  showSubmenu(audioMenuTrigger, audioMenu);
  subtitleMenu.hidden = true;
});

playButton.addEventListener("click", () => {
  if (!current) return;
  if (current.player.playing) current.player.pause();
  else {
    playbackHint.hidden = true;
    void current.player.play().catch(showError);
  }
});

playbackHint.addEventListener("click", () => {
  playbackHint.hidden = true;
  void current?.player.play().catch(showError);
});

volume.addEventListener("input", () => {
  current?.player.setVolume(Number(volume.value));
  muteButton.textContent = "静音";
});

timeline.addEventListener("pointerdown", () => {
  scrubbing = true;
});

timeline.addEventListener("input", () => {
  scrubbing = true;
  time.textContent =
    `${formatTime(Number(timeline.value))} / ` +
    `${formatTime(Number(timeline.max))}`;
});

timeline.addEventListener("change", () => {
  scrubbing = false;
  if (!current) return;
  void current.player.seek(Number(timeline.value));
});

timeline.addEventListener("pointercancel", () => {
  scrubbing = false;
});

muteButton.addEventListener("click", () => {
  const muted = muteButton.textContent === "取消静音";
  current?.player.setMuted(!muted);
  muteButton.textContent = muted ? "静音" : "取消静音";
});

client.onLaunchAvailable(() => void claimPendingLaunch());
void initialize();

window.addEventListener("pagehide", () => {
  current?.player.dispose();
  current?.subtitles.dispose();
  current?.source.close();
  client.dispose();
});

async function initialize(): Promise<void> {
  try {
    const capabilities = await client.capabilities();
    if (!capabilities.singleRangeRead) {
      throw new ResourceSessionError(
        "RANGE_UNSUPPORTED",
        "当前宿主不支持播放器所需的 Range 读取",
      );
    }
    status.textContent = "Resource Session v1 已连接";
    delete status.dataset.failed;
    await claimPendingLaunch(true);
  } catch (error) {
    showError(error);
    openButton.disabled = true;
  }
}

async function claimPendingLaunch(quiet = false): Promise<void> {
  if (opening) return;
  opening = true;
  try {
    const launch = await client.claimLaunch();
    await acceptSession(launch.resource);
  } catch (error) {
    if (
      quiet &&
      error instanceof ResourceSessionError &&
      error.code === "NO_LAUNCH_CONTEXT"
    ) {
      return;
    }
    showError(error);
  } finally {
    opening = false;
  }
}

async function runOpen(select: () => Promise<ResourceSession>): Promise<void> {
  if (opening) return;
  opening = true;
  openButton.disabled = true;
  try {
    await acceptSession(await select());
  } catch (error) {
    if (
      !(error instanceof ResourceSessionError) ||
      error.code !== "USER_CANCELLED"
    ) {
      showError(error);
    }
  } finally {
    opening = false;
    openButton.disabled = false;
  }
}

async function acceptSession(session: ResourceSession): Promise<void> {
  const nextSource = new ResourceRangeSource(session);
  status.textContent = "正在探测媒体…";
  delete status.dataset.failed;
  let media: ProbedMedia;
  let player: MediaPlayer;
  let subtitles: SubtitleController;
  try {
    media = await probeMedia(nextSource);
    player = await MediaPlayer.create(
      media.input,
      canvas,
      {
        onPosition: updatePosition,
        onState: (playing) => {
          playButton.textContent = playing ? "暂停" : "播放";
        },
        onStatus: (playbackStatus) => {
          status.textContent = {
            buffering: "正在缓冲…",
            playing: "正在播放",
            ready: "已定位，点击播放",
          }[playbackStatus];
          delete status.dataset.failed;
        },
        onError: showError,
      },
      () => createMediaInput(nextSource),
      () => nextSource.cancelPending(),
    );
    subtitles = new SubtitleController(nextSource, subtitleOverlay, {
      onTracks: (tracks) => {
        if (current?.source !== nextSource) return;
        subtitleTracks = tracks;
        renderSubtitleMenu();
      },
      onSelection: () => renderSubtitleMenu(),
      onError: (error) => {
        if (current?.source !== nextSource) return;
        status.textContent =
          error instanceof Error ? error.message : "字幕读取失败";
        status.dataset.failed = "true";
      },
    });
  } catch (error) {
    nextSource.close();
    await client.release(session).catch(() => {});
    throw error;
  }
  const previous = current;
  current = { session, source: nextSource, media, player, subtitles };
  subtitleTracks = [];
  renderSubtitleMenu();
  void subtitles.initialize();
  if (previous) {
    previous.player.dispose();
    previous.subtitles.dispose();
    previous.source.close();
    await client.release(previous.session).catch(() => {});
  }
  filename.textContent = session.metadata.name;
  mediaInfo.textContent =
    `${formatBytes(session.metadata.size)} · ${formatProbeInfo(media.info)}`;
  const unsupported = [
    media.info.video && !media.info.video.decodable ? "视频" : "",
    media.info.audio && !media.info.audio.decodable ? "音频" : "",
  ].filter(Boolean);
  status.textContent =
    unsupported.length > 0
      ? `容器解析成功，但浏览器不支持${unsupported.join("和")}编码`
      : "容器和编码探测通过";
  const playable = unsupported.length === 0 && player.duration > 0;
  playButton.disabled = !playable;
  timeline.disabled = !playable;
  muteButton.disabled = !playable || !media.info.audio;
  volume.disabled = !playable || !media.info.audio;
  emptyState.hidden = playable;
  if (playable) {
    playbackHint.hidden = false;
    status.textContent = "缓冲完成，点击播放";
  }
}

function showError(error: unknown): void {
  status.textContent =
    error instanceof Error ? error.message : "WildPlay 操作失败";
  status.dataset.failed = "true";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

function updatePosition(position: number, duration: number): void {
  current?.subtitles.updatePosition(position);
  if (scrubbing) return;
  time.textContent = `${formatTime(position)} / ${formatTime(duration)}`;
  timeline.max = String(Math.max(1, duration));
  timeline.value = String(position);
}

function openContextMenu(x: number, y: number): void {
  renderAudioMenu();
  renderSubtitleMenu();
  contextMenu.hidden = false;
  audioMenu.hidden = true;
  subtitleMenu.hidden = true;
  const width = contextMenu.offsetWidth;
  const height = contextMenu.offsetHeight;
  contextMenu.style.left = `${Math.max(4, Math.min(x, innerWidth - width - 4))}px`;
  contextMenu.style.top = `${Math.max(4, Math.min(y, innerHeight - height - 4))}px`;
}

function closeContextMenu(): void {
  contextMenu.hidden = true;
  audioMenu.hidden = true;
  subtitleMenu.hidden = true;
}

function showSubmenu(trigger: HTMLElement, menu: HTMLElement): void {
  const bounds = trigger.getBoundingClientRect();
  menu.hidden = false;
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const preferredLeft = bounds.right + 3;
  menu.style.left =
    `${preferredLeft + width <= innerWidth ? preferredLeft : bounds.left - width - 3}px`;
  menu.style.top =
    `${Math.max(4, Math.min(bounds.top, innerHeight - height - 4))}px`;
}

function renderAudioMenu(): void {
  audioMenu.replaceChildren();
  const tracks = current?.media.audioTracks ?? [];
  for (const [index, track] of tracks.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "context-menu-item subtitle-menu-item";
    button.role = "menuitemradio";
    button.textContent = formatAudioTrack(track, index);
    button.disabled = !track.decodable;
    button.setAttribute(
      "aria-checked",
      String(current?.player.selectedAudioTrackNumber === track.number),
    );
    button.addEventListener("click", () => {
      closeContextMenu();
      void selectAudioTrack(track);
    });
    audioMenu.append(button);
  }
  if (tracks.length === 0) {
    const empty = document.createElement("button");
    empty.type = "button";
    empty.className = "context-menu-item";
    empty.textContent = "没有音轨";
    empty.disabled = true;
    audioMenu.append(empty);
  }
}

async function selectAudioTrack(track: AudioTrackProbeInfo): Promise<void> {
  if (!current || !track.decodable) return;
  try {
    status.textContent = "正在切换音轨…";
    delete status.dataset.failed;
    await current.player.selectAudioTrack(track.number);
    renderAudioMenu();
  } catch (error) {
    showError(error);
  }
}

function formatAudioTrack(
  track: AudioTrackProbeInfo,
  index: number,
): string {
  const name = track.name?.trim();
  const language = track.language !== "und" ? track.language : undefined;
  const identity = name && language
    ? `${name} · ${language}`
    : name ?? language ?? `音轨 ${index + 1}`;
  return `${identity} · ${track.codec} · ${track.channels}ch`;
}

function renderSubtitleMenu(): void {
  subtitleMenu.replaceChildren();
  subtitleMenu.append(createSubtitleItem("关闭", undefined));
  const supported = subtitleTracks.filter((track) => track.supported);
  for (const [index, track] of supported.entries()) {
    subtitleMenu.append(
      createSubtitleItem(
        formatSubtitleTrack(track, index),
        track.number,
      ),
    );
  }
  if (supported.length === 0) {
    const empty = document.createElement("button");
    empty.type = "button";
    empty.className = "context-menu-item";
    empty.textContent = subtitleTracks.length > 0
      ? "无受支持的文本字幕"
      : "未发现文本字幕";
    empty.disabled = true;
    subtitleMenu.append(empty);
  }
}

function formatSubtitleTrack(
  track: MatroskaSubtitleTrack,
  index: number,
): string {
  const name = track.name?.trim();
  const language = track.language !== "und" ? track.language : undefined;
  if (name && language) return `${name} · ${language}`;
  return name ?? language ?? `字幕 ${index + 1}`;
}

function createSubtitleItem(
  label: string,
  trackNumber: number | undefined,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "context-menu-item subtitle-menu-item";
  button.role = "menuitemradio";
  button.textContent = label;
  button.setAttribute(
    "aria-checked",
    String(current?.subtitles.selectedTrackNumber === trackNumber),
  );
  button.addEventListener("click", () => {
    current?.subtitles.select(trackNumber);
    closeContextMenu();
  });
  return button;
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  const mm = minutes.toString().padStart(2, "0");
  const ss = remaining.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function showFullscreenControls(): void {
  clearFullscreenControlsTimer();
  document.documentElement.classList.remove("fullscreen-controls-hidden");
  fullscreenControlsTimer = window.setTimeout(() => {
    document.documentElement.classList.add("fullscreen-controls-hidden");
  }, 2500);
}

function clearFullscreenControlsTimer(): void {
  if (fullscreenControlsTimer !== undefined) {
    window.clearTimeout(fullscreenControlsTimer);
    fullscreenControlsTimer = undefined;
  }
  document.documentElement.classList.remove("fullscreen-controls-hidden");
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
