export interface EbmlElement {
  id: number;
  offset: number;
  headerSize: number;
  dataOffset: number;
  dataSize: number | undefined;
  endOffset: number | undefined;
}

export interface Vint {
  length: number;
  value: number;
  unknown: boolean;
}

export function readElementHeader(
  bytes: Uint8Array,
  offset = 0,
  absoluteOffset = 0,
): EbmlElement {
  const id = readId(bytes, offset);
  const size = readVint(bytes, offset + id.length);
  const headerSize = id.length + size.length;
  const dataOffset = absoluteOffset + offset + headerSize;
  const dataSize = size.unknown ? undefined : size.value;
  const endOffset =
    dataSize === undefined ? undefined : safeAdd(dataOffset, dataSize);
  return {
    id: id.value,
    offset: absoluteOffset + offset,
    headerSize,
    dataOffset,
    dataSize,
    endOffset,
  };
}

export function readVint(bytes: Uint8Array, offset = 0): Vint {
  const first = bytes[offset];
  if (first === undefined || first === 0) throw invalid("无效或截断的 EBML VINT");
  const length = Math.clz32(first) - 24 + 1;
  if (length > 8 || offset + length > bytes.length) {
    throw invalid("截断的 EBML VINT");
  }
  const marker = 1 << (8 - length);
  let value = first & (marker - 1);
  let unknown = value === marker - 1;
  for (let index = 1; index < length; index += 1) {
    unknown &&= bytes[offset + index] === 0xff;
  }
  if (unknown) return { length, value: 0, unknown: true };
  for (let index = 1; index < length; index += 1) {
    const byte = bytes[offset + index]!;
    value = safeAdd(value * 256, byte);
  }
  return { length, value, unknown: false };
}

export function readId(
  bytes: Uint8Array,
  offset = 0,
): { length: number; value: number } {
  const first = bytes[offset];
  if (first === undefined || first === 0) throw invalid("无效或截断的 EBML ID");
  const length = Math.clz32(first) - 24 + 1;
  if (length > 4 || offset + length > bytes.length) {
    throw invalid("截断或过长的 EBML ID");
  }
  let value = 0;
  for (let index = 0; index < length; index += 1) {
    value = value * 256 + bytes[offset + index]!;
  }
  return { length, value };
}

export function childElements(
  bytes: Uint8Array,
  absoluteOffset = 0,
): EbmlElement[] {
  const result: EbmlElement[] = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    const element = readElementHeader(bytes, cursor, absoluteOffset);
    if (
      element.dataSize === undefined ||
      element.endOffset === undefined ||
      element.endOffset > absoluteOffset + bytes.length
    ) {
      throw invalid("EBML 子元素超出父元素边界");
    }
    result.push(element);
    cursor = element.endOffset - absoluteOffset;
  }
  return result;
}

export function payload(
  bytes: Uint8Array,
  element: EbmlElement,
  absoluteOffset = 0,
): Uint8Array {
  if (element.endOffset === undefined) throw invalid("未知长度元素没有完整载荷");
  const start = element.dataOffset - absoluteOffset;
  const end = element.endOffset - absoluteOffset;
  if (start < 0 || end > bytes.length) throw invalid("EBML 载荷超出缓冲区");
  return bytes.subarray(start, end);
}

export function readUnsigned(bytes: Uint8Array): number {
  if (bytes.length > 8) throw invalid("EBML 无符号整数过长");
  let value = 0;
  for (const byte of bytes) value = safeAdd(value * 256, byte);
  return value;
}

export function readFloat(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length === 4) return view.getFloat32(0);
  if (bytes.length === 8) return view.getFloat64(0);
  throw invalid("EBML 浮点数长度无效");
}

export function readText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).replace(/\0+$/u, "");
}

export function findChild(
  bytes: Uint8Array,
  id: number,
  absoluteOffset = 0,
): EbmlElement | undefined {
  return childElements(bytes, absoluteOffset).find((element) => element.id === id);
}

function safeAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw invalid("EBML 数值超出安全整数范围");
  return value;
}

function invalid(message: string): Error {
  return new Error(`Matroska 字幕解析失败：${message}`);
}
