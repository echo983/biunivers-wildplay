import "./style.css";
import {
  formatProbeInfo,
  probeMedia,
  type ProbedMedia,
} from "./media/probe";
import { MediaPlayer } from "./media/player";
import { ResourceSessionClient } from "./resourceSession/client";
import { ResourceRangeSource } from "./resourceSession/rangeSource";
import {
  ResourceSessionError,
  type ResourceSession,
} from "./resourceSession/types";

const openButton = requireElement<HTMLButtonElement>("open-file");
const playButton = requireElement<HTMLButtonElement>("play-pause");
const muteButton = requireElement<HTMLButtonElement>("mute");
const volume = requireElement<HTMLInputElement>("volume");
const timeline = requireElement<HTMLInputElement>("timeline");
const time = requireElement<HTMLSpanElement>("time");
const canvas = requireElement<HTMLCanvasElement>("video-canvas");
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
    }
  | undefined;
let opening = false;
let scrubbing = false;

openButton.addEventListener("click", () => {
  void runOpen(async () => await client.open());
});

fullscreenButton.addEventListener("click", async () => {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await document.documentElement.requestFullscreen();
  }
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
  current?.media.input.dispose();
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
  try {
    media = await probeMedia(nextSource);
    player = await MediaPlayer.create(media.input, canvas, {
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
    });
  } catch (error) {
    nextSource.close();
    await client.release(session).catch(() => {});
    throw error;
  }
  const previous = current;
  current = { session, source: nextSource, media, player };
  if (previous) {
    previous.player.dispose();
    previous.media.input.dispose();
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
  if (scrubbing) return;
  time.textContent = `${formatTime(position)} / ${formatTime(duration)}`;
  timeline.max = String(Math.max(1, duration));
  timeline.value = String(position);
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

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
