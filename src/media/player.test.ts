import { describe, expect, it } from "vitest";
import { findAudioTrackByNumber, getAudioBufferOffset } from "./player";

describe("getAudioBufferOffset", () => {
  it("keeps future buffers intact", () => {
    expect(getAudioBufferOffset(10, 0.5, 9.5)).toBe(0);
  });

  it("starts a partially late buffer at the current sample", () => {
    expect(getAudioBufferOffset(10, 0.5, 10.2)).toBeCloseTo(0.2);
  });

  it("drops buffers that have completely expired", () => {
    expect(getAudioBufferOffset(10, 0.5, 10.5)).toBeNull();
    expect(getAudioBufferOffset(10, 0.5, 12)).toBeNull();
  });
});

describe("findAudioTrackByNumber", () => {
  it("restores the same audio track on a rebuilt input", () => {
    const tracks = [
      { number: 1, language: "jpn" },
      { number: 2, language: "eng" },
    ];
    expect(findAudioTrackByNumber(tracks, 2)).toEqual({
      number: 2,
      language: "eng",
    });
    expect(findAudioTrackByNumber(tracks, 3)).toBeUndefined();
  });
});
