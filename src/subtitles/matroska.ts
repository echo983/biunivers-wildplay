import {
  childElements,
  payload,
  readElementHeader,
  readFloat,
  readText,
  readUnsigned,
  type EbmlElement,
} from "./ebml";

const ID = {
  EBML: 0x1a45dfa3,
  DOC_TYPE: 0x4282,
  SEGMENT: 0x18538067,
  SEEK_HEAD: 0x114d9b74,
  SEEK: 0x4dbb,
  SEEK_ID: 0x53ab,
  SEEK_POSITION: 0x53ac,
  INFO: 0x1549a966,
  TIMESTAMP_SCALE: 0x2ad7b1,
  TRACKS: 0x1654ae6b,
  TRACK_ENTRY: 0xae,
  TRACK_NUMBER: 0xd7,
  TRACK_UID: 0x73c5,
  TRACK_TYPE: 0x83,
  FLAG_DEFAULT: 0x88,
  NAME: 0x536e,
  LANGUAGE: 0x22b59c,
  LANGUAGE_IETF: 0x22b59d,
  CODEC_ID: 0x86,
  TRACK_TIMESTAMP_SCALE: 0x23314f,
  CONTENT_ENCODINGS: 0x6d80,
  CUES: 0x1c53bb6b,
  CUE_POINT: 0xbb,
  CUE_TIME: 0xb3,
  CUE_TRACK_POSITIONS: 0xb7,
  CUE_TRACK: 0xf7,
  CUE_CLUSTER_POSITION: 0xf1,
  CUE_DURATION: 0xb2,
  CLUSTER: 0x1f43b675,
  CLUSTER_TIMESTAMP: 0xe7,
  SIMPLE_BLOCK: 0xa3,
  BLOCK_GROUP: 0xa0,
  BLOCK: 0xa1,
  BLOCK_DURATION: 0x9b,
} as const;

const TEXT_CODECS = new Set([
  "S_TEXT/UTF8",
  "S_TEXT/ASS",
  "S_TEXT/SSA",
  "S_TEXT/WEBVTT",
]);

const HEADER_PROBE_BYTES = 2 * 1024 * 1024;
const MAX_METADATA_ELEMENT_BYTES = 32 * 1024 * 1024;
const MAX_CLUSTER_BYTES = 16 * 1024 * 1024;

export interface RandomAccessReader {
  readonly size: number;
  read(start: number, endExclusive: number): Promise<Uint8Array>;
}

export interface MatroskaSubtitleTrack {
  number: number;
  uid?: number;
  codecId: string;
  name?: string;
  language: string;
  default: boolean;
  timestampScale: number;
  supported: boolean;
  unsupportedReason?: string;
}

export interface MatroskaCue {
  time: number;
  track: number;
  clusterOffset: number;
  duration?: number;
}

export interface MatroskaSubtitleIndex {
  segmentDataOffset: number;
  timestampScaleNanoseconds: number;
  tracks: MatroskaSubtitleTrack[];
  cues: MatroskaCue[];
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export async function probeMatroskaSubtitles(
  source: RandomAccessReader,
): Promise<MatroskaSubtitleIndex | undefined> {
  if (source.size < 8) return undefined;
  const initial = await source.read(0, Math.min(source.size, HEADER_PROBE_BYTES));
  let ebml: EbmlElement;
  try {
    ebml = readElementHeader(initial);
  } catch {
    return undefined;
  }
  if (ebml.id !== ID.EBML || ebml.endOffset === undefined) return undefined;
  if (ebml.endOffset > initial.length) throw invalid("EBML Header 过大");
  const docType = childValue(initial, ebml, ID.DOC_TYPE, readText);
  if (docType !== "matroska" && docType !== "webm") return undefined;

  const segment = readElementHeader(initial, ebml.endOffset);
  if (segment.id !== ID.SEGMENT) throw invalid("没有找到 Segment");
  const segmentDataOffset = segment.dataOffset;
  const initialTopLevel = scanTopLevel(initial, segmentDataOffset);
  const seekHead = initialTopLevel.find((element) => element.id === ID.SEEK_HEAD);
  const directPositions = new Map<number, number>();
  for (const element of initialTopLevel) {
    if (
      element.id === ID.INFO ||
      element.id === ID.TRACKS ||
      element.id === ID.CUES
    ) {
      directPositions.set(element.id, element.offset);
    }
  }
  if (seekHead) {
    const seekBytes = await elementBytes(source, seekHead);
    for (const [id, relativePosition] of parseSeekHead(seekBytes)) {
      directPositions.set(id, segmentDataOffset + relativePosition);
    }
  }

  const tracksPosition = directPositions.get(ID.TRACKS);
  if (tracksPosition === undefined) return emptyIndex(segmentDataOffset);
  const tracksElement = await readWholeElement(source, tracksPosition);
  const tracks = parseTracks(tracksElement.bytes, tracksElement.element);
  if (tracks.length === 0) return emptyIndex(segmentDataOffset);

  let timestampScaleNanoseconds = 1_000_000;
  const infoPosition = directPositions.get(ID.INFO);
  if (infoPosition !== undefined) {
    const info = await readWholeElement(source, infoPosition);
    timestampScaleNanoseconds =
      childValue(
        info.bytes,
        info.element,
        ID.TIMESTAMP_SCALE,
        readUnsigned,
      ) ?? timestampScaleNanoseconds;
  }

  let cues: MatroskaCue[] = [];
  const cuesPosition = directPositions.get(ID.CUES);
  if (cuesPosition !== undefined) {
    const cueElement = await readWholeElement(source, cuesPosition);
    cues = parseCues(
      cueElement.bytes,
      cueElement.element,
      segmentDataOffset,
      timestampScaleNanoseconds,
    );
  }
  return {
    segmentDataOffset,
    timestampScaleNanoseconds,
    tracks: markIndexAvailability(tracks, cues),
    cues,
  };
}

export async function loadSubtitleWindow(
  source: RandomAccessReader,
  index: MatroskaSubtitleIndex,
  track: MatroskaSubtitleTrack,
  position: number,
  windowSeconds = 45,
): Promise<SubtitleCue[]> {
  if (!track.supported) {
    throw invalid(track.unsupportedReason ?? "字幕轨不受支持");
  }
  const trackCues = index.cues.filter((cue) => cue.track === track.number);
  const locatorCues = trackCues.length > 0 ? trackCues : index.cues;
  if (locatorCues.length === 0) throw invalid("没有可用于随机读取的 Cue");
  const first = Math.max(0, findCueAtOrBefore(locatorCues, position));
  const endTime = position + windowSeconds;
  const offsets: number[] = [];
  for (let cueIndex = first; cueIndex < locatorCues.length; cueIndex += 1) {
    const cue = locatorCues[cueIndex]!;
    if (cue.time > endTime && offsets.length > 0) break;
    if (offsets.at(-1) !== cue.clusterOffset) offsets.push(cue.clusterOffset);
  }
  const result: SubtitleCue[] = [];
  for (const offset of offsets) {
    const cluster = await readWholeElement(source, offset, MAX_CLUSTER_BYTES);
    if (cluster.element.id !== ID.CLUSTER) throw invalid("Cue 没有指向 Cluster");
    result.push(
      ...parseCluster(
        cluster.bytes,
        cluster.element,
        track,
        index.timestampScaleNanoseconds,
      ),
    );
  }
  return normalizeCueEnds(
    result
      .filter((cue) => cue.end >= position - 1 && cue.start <= endTime)
      .sort((left, right) => left.start - right.start),
  );
}

function emptyIndex(segmentDataOffset: number): MatroskaSubtitleIndex {
  return {
    segmentDataOffset,
    timestampScaleNanoseconds: 1_000_000,
    tracks: [],
    cues: [],
  };
}

function parseSeekHead(bytes: Uint8Array): Map<number, number> {
  const root = readElementHeader(bytes);
  const entries = new Map<number, number>();
  for (const seek of childrenOf(bytes, root).filter(
    (element) => element.id === ID.SEEK,
  )) {
    const seekId = childValue(bytes, seek, ID.SEEK_ID, readUnsigned);
    const position = childValue(bytes, seek, ID.SEEK_POSITION, readUnsigned);
    if (seekId !== undefined && position !== undefined) {
      entries.set(seekId, position);
    }
  }
  return entries;
}

function parseTracks(
  bytes: Uint8Array,
  root: EbmlElement,
): MatroskaSubtitleTrack[] {
  const result: MatroskaSubtitleTrack[] = [];
  for (const entry of childrenOf(bytes, root).filter(
    (element) => element.id === ID.TRACK_ENTRY,
  )) {
    if (childValue(bytes, entry, ID.TRACK_TYPE, readUnsigned) !== 17) continue;
    const number = childValue(bytes, entry, ID.TRACK_NUMBER, readUnsigned);
    const codecId = childValue(bytes, entry, ID.CODEC_ID, readText);
    if (number === undefined || codecId === undefined) continue;
    const compressed = child(bytes, entry, ID.CONTENT_ENCODINGS) !== undefined;
    const supportedCodec = TEXT_CODECS.has(codecId);
    result.push({
      number,
      uid: childValue(bytes, entry, ID.TRACK_UID, readUnsigned),
      codecId,
      name: childValue(bytes, entry, ID.NAME, readText),
      language:
        childValue(bytes, entry, ID.LANGUAGE_IETF, readText) ??
        childValue(bytes, entry, ID.LANGUAGE, readText) ??
        "und",
      default: (childValue(bytes, entry, ID.FLAG_DEFAULT, readUnsigned) ?? 1) !== 0,
      timestampScale:
        childValue(bytes, entry, ID.TRACK_TIMESTAMP_SCALE, readFloat) ?? 1,
      supported: supportedCodec && !compressed,
      unsupportedReason: !supportedCodec
        ? "不是首版支持的文本字幕"
        : compressed
          ? "首版不支持 ContentEncoding 字幕轨"
          : undefined,
    });
  }
  return result;
}

function parseCues(
  bytes: Uint8Array,
  root: EbmlElement,
  segmentDataOffset: number,
  timestampScaleNanoseconds: number,
): MatroskaCue[] {
  const result: MatroskaCue[] = [];
  for (const point of childrenOf(bytes, root).filter(
    (element) => element.id === ID.CUE_POINT,
  )) {
    const rawTime = childValue(bytes, point, ID.CUE_TIME, readUnsigned);
    if (rawTime === undefined) continue;
    for (const position of childrenOf(bytes, point).filter(
      (element) => element.id === ID.CUE_TRACK_POSITIONS,
    )) {
      const track = childValue(bytes, position, ID.CUE_TRACK, readUnsigned);
      const relativeCluster = childValue(
        bytes,
        position,
        ID.CUE_CLUSTER_POSITION,
        readUnsigned,
      );
      if (track === undefined || relativeCluster === undefined) continue;
      const rawDuration = childValue(
        bytes,
        position,
        ID.CUE_DURATION,
        readUnsigned,
      );
      result.push({
        time: rawTime * timestampScaleNanoseconds / 1e9,
        track,
        clusterOffset: segmentDataOffset + relativeCluster,
        duration:
          rawDuration === undefined
            ? undefined
            : rawDuration * timestampScaleNanoseconds / 1e9,
      });
    }
  }
  return result.sort((left, right) => left.time - right.time);
}

function markIndexAvailability(
  tracks: MatroskaSubtitleTrack[],
  cues: MatroskaCue[],
): MatroskaSubtitleTrack[] {
  if (cues.length > 0) return tracks;
  return tracks.map((track) =>
    track.supported
      ? {
          ...track,
          supported: false,
          unsupportedReason: "文件没有可用于随机读取的 Cue",
        }
      : track,
  );
}

async function readWholeElement(
  source: RandomAccessReader,
  offset: number,
  maxBytes = MAX_METADATA_ELEMENT_BYTES,
): Promise<{ bytes: Uint8Array; element: EbmlElement }> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= source.size) {
    throw invalid("索引位置超出文件边界");
  }
  const headerEnd = Math.min(source.size, offset + 12);
  const headerBytes = await source.read(offset, headerEnd);
  const header = readElementHeader(headerBytes, 0, offset);
  if (
    header.dataSize === undefined ||
    header.endOffset === undefined ||
    header.endOffset > source.size ||
    header.endOffset - offset > maxBytes
  ) {
    throw invalid("元数据元素长度无效或过大");
  }
  const bytes = await source.read(offset, header.endOffset);
  return { bytes, element: readElementHeader(bytes) };
}

function parseCluster(
  bytes: Uint8Array,
  root: EbmlElement,
  track: MatroskaSubtitleTrack,
  timestampScaleNanoseconds: number,
): SubtitleCue[] {
  const clusterTime =
    childValue(bytes, root, ID.CLUSTER_TIMESTAMP, readUnsigned) ?? 0;
  const result: SubtitleCue[] = [];
  for (const element of childrenOf(bytes, root)) {
    if (element.id === ID.SIMPLE_BLOCK) {
      const cue = parseSubtitleBlock(
        payload(bytes, element),
        undefined,
        clusterTime,
        track,
        timestampScaleNanoseconds,
      );
      if (cue) result.push(cue);
    } else if (element.id === ID.BLOCK_GROUP) {
      const block = child(bytes, element, ID.BLOCK);
      if (!block) continue;
      const duration = childValue(
        bytes,
        element,
        ID.BLOCK_DURATION,
        readUnsigned,
      );
      const cue = parseSubtitleBlock(
        payload(bytes, block),
        duration,
        clusterTime,
        track,
        timestampScaleNanoseconds,
      );
      if (cue) result.push(cue);
    }
  }
  return result;
}

function parseSubtitleBlock(
  bytes: Uint8Array,
  rawDuration: number | undefined,
  clusterTime: number,
  track: MatroskaSubtitleTrack,
  timestampScaleNanoseconds: number,
): SubtitleCue | undefined {
  const trackNumber = readBlockTrackNumber(bytes);
  if (trackNumber.value !== track.number) return undefined;
  const header = trackNumber.length + 3;
  if (bytes.length < header) throw invalid("字幕 Block Header 截断");
  const flags = bytes[trackNumber.length + 2]!;
  if ((flags & 0x06) !== 0) throw invalid("首版不支持带 lacing 的字幕 Block");
  const relativeTime = new DataView(
    bytes.buffer,
    bytes.byteOffset + trackNumber.length,
    2,
  ).getInt16(0);
  const unitSeconds = timestampScaleNanoseconds * track.timestampScale / 1e9;
  const start = (clusterTime + relativeTime) * unitSeconds;
  const duration =
    rawDuration === undefined ? 5 : Math.max(0, rawDuration * unitSeconds);
  return {
    start,
    end: start + Math.min(duration, 30),
    text: decodeSubtitleText(bytes.subarray(header), track.codecId),
  };
}

function readBlockTrackNumber(bytes: Uint8Array): {
  length: number;
  value: number;
} {
  const first = bytes[0];
  if (first === undefined || first === 0) throw invalid("字幕 Block TrackNumber 无效");
  const length = Math.clz32(first) - 24 + 1;
  if (length > 8 || length + 3 > bytes.length) {
    throw invalid("字幕 Block Header 截断");
  }
  const marker = 1 << (8 - length);
  let value = first & (marker - 1);
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + bytes[index]!;
  }
  if (!Number.isSafeInteger(value)) throw invalid("字幕 TrackNumber 过大");
  return { length, value };
}

export function decodeSubtitleText(bytes: Uint8Array, codecId: string): string {
  let text = new TextDecoder().decode(bytes).replace(/\0+$/u, "");
  if (codecId === "S_TEXT/ASS" || codecId === "S_TEXT/SSA") {
    const fieldCount = 8;
    let cursor = 0;
    for (let field = 0; field < fieldCount; field += 1) {
      const comma = text.indexOf(",", cursor);
      if (comma < 0) {
        cursor = 0;
        break;
      }
      cursor = comma + 1;
    }
    if (cursor > 0) text = text.slice(cursor);
    text = text
      .replace(/\{[^}]*\}/gu, "")
      .replace(/\\[Nn]/gu, "\n")
      .replace(/\\h/gu, "\u00a0");
  }
  return text.trim();
}

function normalizeCueEnds(cues: SubtitleCue[]): SubtitleCue[] {
  return cues.map((cue, index) => {
    const next = cues[index + 1];
    if (!next || cue.end !== cue.start + 5 || next.start <= cue.start) return cue;
    return { ...cue, end: Math.min(cue.end, next.start) };
  });
}

function findCueAtOrBefore(cues: MatroskaCue[], time: number): number {
  let low = 0;
  let high = cues.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (cues[middle]!.time <= time) low = middle + 1;
    else high = middle - 1;
  }
  return high;
}

async function elementBytes(
  source: RandomAccessReader,
  element: EbmlElement,
): Promise<Uint8Array> {
  if (element.endOffset === undefined || element.endOffset > source.size) {
    throw invalid("元数据元素越界");
  }
  if (element.offset === 0) return source.read(0, element.endOffset);
  return source.read(element.offset, element.endOffset);
}

function scanTopLevel(bytes: Uint8Array, start: number): EbmlElement[] {
  const result: EbmlElement[] = [];
  let cursor = start;
  while (cursor < bytes.length) {
    let element: EbmlElement;
    try {
      element = readElementHeader(bytes, cursor);
    } catch {
      break;
    }
    result.push(element);
    if (element.endOffset === undefined || element.endOffset <= cursor) break;
    cursor = element.endOffset;
  }
  return result;
}

function childrenOf(bytes: Uint8Array, parent: EbmlElement): EbmlElement[] {
  return childElements(payload(bytes, parent), parent.dataOffset);
}

function child(
  bytes: Uint8Array,
  parent: EbmlElement,
  id: number,
): EbmlElement | undefined {
  return childrenOf(bytes, parent).find((element) => element.id === id);
}

function childValue<T>(
  bytes: Uint8Array,
  parent: EbmlElement,
  id: number,
  decode: (value: Uint8Array) => T,
): T | undefined {
  const element = child(bytes, parent, id);
  return element
    ? decode(payload(bytes, element))
    : undefined;
}

function invalid(message: string): Error {
  return new Error(`Matroska 字幕解析失败：${message}`);
}
