import { describe, expect, it } from "vitest";
import {
  formatAudioSummary,
  formatProbeInfo,
  isAudioOnly,
  SUPPORTED_INPUT_FORMATS,
} from "./probe";

describe("formatProbeInfo", () => {
  it("formats a video and audio probe compactly", () => {
    expect(
      formatProbeInfo({
        container: "Matroska",
        mimeType: "video/x-matroska",
        durationSeconds: 3723.4,
        video: {
          codec: "avc1.640028",
          width: 1920,
          height: 1080,
          decodable: true,
        },
        audio: {
          codec: "opus",
          channels: 2,
          sampleRate: 48000,
          decodable: true,
        },
      }),
    ).toBe("Matroska · 1920×1080 · avc1.640028 · opus · 1:02:03");
  });

  it("supports an audio-only media result", () => {
    const info = {
      container: "WebM",
      mimeType: "audio/webm",
      durationSeconds: null,
      video: null,
      audio: {
        codec: "opus",
        channels: 2,
        sampleRate: 48000,
        decodable: false,
      },
    };
    expect(formatProbeInfo(info)).toBe("WebM · opus");
    expect(isAudioOnly(info)).toBe(true);
    expect(formatAudioSummary(info)).toBe("opus · 2 声道 · 48 kHz");
  });

  it("registers standalone audio input formats", () => {
    expect(SUPPORTED_INPUT_FORMATS.map((format) => format.name)).toEqual(
      expect.arrayContaining(["MP3", "FLAC", "ADTS", "Ogg", "WAVE"]),
    );
  });
});
