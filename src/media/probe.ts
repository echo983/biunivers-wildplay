import {
  CustomSource,
  Input,
  MATROSKA,
  MP4,
  WEBM,
  type InputAudioTrack,
  type InputVideoTrack,
} from "mediabunny";
import { ResourceRangeSource } from "../resourceSession/rangeSource";

const SOURCE_CACHE_BYTES = 8 * 1024 * 1024;

export interface MediaProbeInfo {
  container: string;
  mimeType: string;
  durationSeconds: number | null;
  video: VideoProbeInfo | null;
  audio: AudioProbeInfo | null;
}

export interface VideoProbeInfo {
  codec: string;
  width: number;
  height: number;
  decodable: boolean;
}

export interface AudioProbeInfo {
  codec: string;
  channels: number;
  sampleRate: number;
  decodable: boolean;
}

export interface ProbedMedia {
  input: Input<CustomSource>;
  info: MediaProbeInfo;
}

export async function probeMedia(
  rangeSource: ResourceRangeSource,
): Promise<ProbedMedia> {
  if (rangeSource.size === 0) {
    throw new Error("空文件不是可播放媒体");
  }

  const input = createMediaInput(rangeSource);

  try {
    const format = await input.getFormat();
    const [durationSeconds, videoTrack, audioTrack, mimeType] =
      await Promise.all([
        input.getDurationFromMetadata(),
        input.getPrimaryVideoTrack(),
        input.getPrimaryAudioTrack(),
        input.getMimeType(),
      ]);

    if (!videoTrack && !audioTrack) {
      throw new Error("媒体中没有可识别的音视频轨道");
    }

    const [video, audio] = await Promise.all([
      videoTrack ? probeVideo(videoTrack) : null,
      audioTrack ? probeAudio(audioTrack) : null,
    ]);

    return {
      input,
      info: {
        container: format.name,
        mimeType,
        durationSeconds,
        video,
        audio,
      },
    };
  } catch (error) {
    input.dispose();
    throw new Error(
      error instanceof Error
        ? `无法解析媒体：${error.message}`
        : "无法解析媒体",
      { cause: error },
    );
  }
}

export function createMediaInput(
  rangeSource: ResourceRangeSource,
): Input<CustomSource> {
  const source = new CustomSource({
    getSize: () => rangeSource.size,
    read: (start, end) => rangeSource.read(start, end),
    maxCacheSize: SOURCE_CACHE_BYTES,
    prefetchProfile: "network",
  });
  return new Input({
    source,
    formats: [MP4, WEBM, MATROSKA],
  });
}

async function probeVideo(track: InputVideoTrack): Promise<VideoProbeInfo> {
  const [codec, width, height, decodable] = await Promise.all([
    track.getCodecParameterString(),
    track.getDisplayWidth(),
    track.getDisplayHeight(),
    track.canDecode(),
  ]);
  return {
    codec: codec ?? "unknown",
    width,
    height,
    decodable,
  };
}

async function probeAudio(track: InputAudioTrack): Promise<AudioProbeInfo> {
  const [codec, channels, sampleRate, decodable] = await Promise.all([
    track.getCodecParameterString(),
    track.getNumberOfChannels(),
    track.getSampleRate(),
    track.canDecode(),
  ]);
  return {
    codec: codec ?? "unknown",
    channels,
    sampleRate,
    decodable,
  };
}

export function formatProbeInfo(info: MediaProbeInfo): string {
  const parts = [info.container];
  if (info.video) {
    parts.push(
      `${info.video.width}×${info.video.height}`,
      info.video.codec,
    );
  }
  if (info.audio) parts.push(info.audio.codec);
  if (info.durationSeconds !== null) {
    parts.push(formatDuration(info.durationSeconds));
  }
  return parts.join(" · ");
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(remaining)}`
    : `${minutes}:${pad(remaining)}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
