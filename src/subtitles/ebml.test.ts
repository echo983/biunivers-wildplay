import { describe, expect, it } from "vitest";
import {
  childElements,
  payload,
  readElementHeader,
  readId,
  readUnsigned,
  readVint,
} from "./ebml";

describe("EBML primitives", () => {
  it("reads ids and finite sizes without dropping the id marker", () => {
    const bytes = Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0x83, 1, 2, 3);
    expect(readId(bytes)).toEqual({ length: 4, value: 0x1a45dfa3 });
    expect(readElementHeader(bytes)).toMatchObject({
      id: 0x1a45dfa3,
      headerSize: 5,
      dataOffset: 5,
      dataSize: 3,
      endOffset: 8,
    });
  });

  it("reads multi-byte values and detects unknown sizes", () => {
    expect(readVint(Uint8Array.of(0x40, 0x7f))).toEqual({
      length: 2,
      value: 127,
      unknown: false,
    });
    expect(readVint(Uint8Array.of(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff)))
      .toMatchObject({ length: 8, value: 0, unknown: true });
  });

  it("walks bounded child elements", () => {
    const bytes = Uint8Array.of(0x81, 0x81, 7, 0x82, 0x82, 8, 9);
    const elements = childElements(bytes, 100);
    expect(elements.map((element) => element.id)).toEqual([0x81, 0x82]);
    expect([...payload(bytes, elements[1]!, 100)]).toEqual([8, 9]);
  });

  it("reads unsigned integers", () => {
    expect(readUnsigned(Uint8Array.of(0x01, 0x00, 0x01))).toBe(65537);
  });

  it("rejects truncation and child overflow", () => {
    expect(() => readId(Uint8Array.of(0x1a, 0x45))).toThrow("截断");
    expect(() => readVint(Uint8Array.of(0x40))).toThrow("截断");
    expect(() => childElements(Uint8Array.of(0x81, 0x84, 1))).toThrow(
      "超出父元素边界",
    );
  });
});
