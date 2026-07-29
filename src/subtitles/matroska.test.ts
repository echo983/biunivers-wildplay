import { describe, expect, it } from "vitest";
import {
  decodeSubtitleText,
  loadSubtitleWindow,
  probeMatroskaSubtitles,
  type MatroskaSubtitleIndex,
  type MatroskaSubtitleTrack,
  type RandomAccessReader,
} from "./matroska";

const id = {
  ebml: [0x1a, 0x45, 0xdf, 0xa3],
  docType: [0x42, 0x82],
  segment: [0x18, 0x53, 0x80, 0x67],
  info: [0x15, 0x49, 0xa9, 0x66],
  timestampScale: [0x2a, 0xd7, 0xb1],
  tracks: [0x16, 0x54, 0xae, 0x6b],
  trackEntry: [0xae],
  trackNumber: [0xd7],
  trackType: [0x83],
  flagDefault: [0x88],
  name: [0x53, 0x6e],
  languageIetf: [0x22, 0xb5, 0x9d],
  codecId: [0x86],
  cues: [0x1c, 0x53, 0xbb, 0x6b],
  cuePoint: [0xbb],
  cueTime: [0xb3],
  cueTrackPositions: [0xb7],
  cueTrack: [0xf7],
  cueClusterPosition: [0xf1],
  cluster: [0x1f, 0x43, 0xb6, 0x75],
  clusterTimestamp: [0xe7],
  simpleBlock: [0xa3],
  blockGroup: [0xa0],
  block: [0xa1],
  blockDuration: [0x9b],
} as const;

describe("Matroska subtitle probe", () => {
  it("discovers supported text tracks and cue offsets", async () => {
    const subtitleTrack = element(
      id.trackEntry,
      join(
        uint(id.trackNumber, 3),
        uint(id.trackType, 17),
        text(id.codecId, "S_TEXT/UTF8"),
        text(id.name, "简体中文"),
        text(id.languageIetf, "zh-Hans"),
        uint(id.flagDefault, 1),
      ),
    );
    const imageTrack = element(
      id.trackEntry,
      join(
        uint(id.trackNumber, 4),
        uint(id.trackType, 17),
        text(id.codecId, "S_HDMV/PGS"),
      ),
    );
    const tracks = element(id.tracks, join(subtitleTrack, imageTrack));
    const info = element(id.info, uint(id.timestampScale, 1_000_000));
    const cues = element(
      id.cues,
      element(
        id.cuePoint,
        join(
          uint(id.cueTime, 1500),
          element(
            id.cueTrackPositions,
            join(uint(id.cueTrack, 3), uint(id.cueClusterPosition, 9000)),
          ),
        ),
      ),
    );
    const ebml = element(id.ebml, text(id.docType, "matroska"));
    const segmentPayload = join(info, tracks, cues);
    const file = join(ebml, element(id.segment, segmentPayload));
    const source = memorySource(file);

    const result = await probeMatroskaSubtitles(source);

    expect(result?.tracks).toHaveLength(2);
    expect(result?.tracks[0]).toMatchObject({
      number: 3,
      codecId: "S_TEXT/UTF8",
      name: "简体中文",
      language: "zh-Hans",
      default: true,
      supported: true,
    });
    expect(result?.tracks[1]).toMatchObject({
      number: 4,
      supported: false,
    });
    expect(result?.cues).toEqual([
      {
        time: 1.5,
        track: 3,
        clusterOffset: result!.segmentDataOffset + 9000,
        duration: undefined,
      },
    ]);
  });

  it("marks text tracks unavailable when the file has no cues", async () => {
    const tracks = element(
      id.tracks,
      element(
        id.trackEntry,
        join(
          uint(id.trackNumber, 2),
          uint(id.trackType, 17),
          text(id.codecId, "S_TEXT/ASS"),
        ),
      ),
    );
    const file = join(
      element(id.ebml, text(id.docType, "matroska")),
      element(id.segment, tracks),
    );

    const result = await probeMatroskaSubtitles(memorySource(file));

    expect(result?.tracks[0]).toMatchObject({
      supported: false,
      unsupportedReason: "文件没有可用于随机读取的 Cue",
    });
  });

  it("returns undefined for another container", async () => {
    expect(
      await probeMatroskaSubtitles(memorySource(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8))),
    ).toBeUndefined();
  });
});

describe("Matroska subtitle blocks", () => {
  const track: MatroskaSubtitleTrack = {
    number: 3,
    codecId: "S_TEXT/UTF8",
    language: "zh",
    default: true,
    timestampScale: 1,
    supported: true,
  };

  it("loads SimpleBlock and BlockGroup cues from an indexed cluster", async () => {
    const cluster = element(
      id.cluster,
      join(
        uint(id.clusterTimestamp, 1000),
        element(id.simpleBlock, block(3, 0, "第一行")),
        element(
          id.blockGroup,
          join(
            element(id.block, block(3, 2000, "第二行")),
            uint(id.blockDuration, 3000),
          ),
        ),
        element(id.simpleBlock, block(4, 0, "别的轨道")),
      ),
    );
    const index: MatroskaSubtitleIndex = {
      segmentDataOffset: 0,
      timestampScaleNanoseconds: 1_000_000,
      tracks: [track],
      cues: [{ time: 1, track: 3, clusterOffset: 0 }],
    };

    const cues = await loadSubtitleWindow(memorySource(cluster), index, track, 1);

    expect(cues).toEqual([
      { start: 1, end: 3, text: "第一行" },
      { start: 3, end: 6, text: "第二行" },
    ]);
  });

  it("converts ASS event text without interpreting styles", () => {
    const value =
      "0,0,Default,Speaker,0,0,0,,{\\i1}Hello\\Nworld{\\i0}";
    expect(
      decodeSubtitleText(new TextEncoder().encode(value), "S_TEXT/ASS"),
    ).toBe("Hello\nworld");
  });
});

function memorySource(bytes: Uint8Array): RandomAccessReader {
  return {
    size: bytes.length,
    async read(start, endExclusive) {
      return bytes.slice(start, endExclusive);
    },
  };
}

function element(elementId: readonly number[], data: Uint8Array): Uint8Array {
  return join(Uint8Array.from(elementId), vint(data.length), data);
}

function text(elementId: readonly number[], value: string): Uint8Array {
  return element(elementId, new TextEncoder().encode(value));
}

function uint(elementId: readonly number[], value: number): Uint8Array {
  const result: number[] = [];
  let remaining = value;
  do {
    result.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  } while (remaining > 0);
  return element(elementId, Uint8Array.from(result));
}

function block(track: number, relativeTime: number, value: string): Uint8Array {
  const textBytes = new TextEncoder().encode(value);
  const output = new Uint8Array(4 + textBytes.length);
  output[0] = 0x80 | track;
  new DataView(output.buffer).setInt16(1, relativeTime);
  output[3] = 0;
  output.set(textBytes, 4);
  return output;
}

function vint(value: number): Uint8Array {
  if (value < 0x7f) return Uint8Array.of(0x80 | value);
  if (value < 0x3fff) return Uint8Array.of(0x40 | (value >> 8), value & 0xff);
  throw new Error("test value too large");
}

function join(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
