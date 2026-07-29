import {
  AudioBufferSink,
  CanvasSink,
  type Input,
  type Source,
  type WrappedAudioBuffer,
  type WrappedCanvas,
} from "mediabunny";

export interface MediaPlayerEvents {
  onPosition(position: number, duration: number): void;
  onState(playing: boolean): void;
  onStatus(status: "buffering" | "playing" | "ready"): void;
  onError(error: unknown): void;
}

const STARTUP_BUFFER_SECONDS = 0.25;
const AUDIO_PREROLL_SECONDS = 1.5;
const MAX_VIDEO_LATENESS_SECONDS = 0.1;

export class MediaPlayer {
  #input: Input<Source>;
  readonly #createInput: () => Input<Source>;
  readonly #cancelPendingReads: () => void;
  readonly #canvas: HTMLCanvasElement;
  readonly #events: MediaPlayerEvents;
  readonly #context = new AudioContext();
  readonly #gain = this.#context.createGain();
  readonly #audioSources = new Set<AudioBufferSourceNode>();
  #videoSink: CanvasSink | null = null;
  #audioSink: AudioBufferSink | null = null;
  #selectedAudioTrackNumber: number | undefined;
  #duration = 0;
  #position = 0;
  #startedAt = 0;
  #generation = 0;
  #playing = false;
  #starting = false;
  #disposed = false;

  private constructor(
    input: Input<Source>,
    createInput: () => Input<Source>,
    cancelPendingReads: () => void,
    canvas: HTMLCanvasElement,
    events: MediaPlayerEvents,
  ) {
    this.#input = input;
    this.#createInput = createInput;
    this.#cancelPendingReads = cancelPendingReads;
    this.#canvas = canvas;
    this.#events = events;
    this.#gain.connect(this.#context.destination);
  }

  static async create(
    input: Input<Source>,
    canvas: HTMLCanvasElement,
    events: MediaPlayerEvents,
    createInput: () => Input<Source>,
    cancelPendingReads: () => void,
  ): Promise<MediaPlayer> {
    const player = new MediaPlayer(
      input,
      createInput,
      cancelPendingReads,
      canvas,
      events,
    );
    try {
      await player.#configureInput(true);
      await player.#prepareFirstSamples();
      player.#events.onPosition(0, player.#duration);
      return player;
    } catch (error) {
      player.dispose();
      throw error;
    }
  }

  get playing(): boolean {
    return this.#playing;
  }

  get duration(): number {
    return this.#duration;
  }

  get selectedAudioTrackNumber(): number | undefined {
    return this.#selectedAudioTrackNumber;
  }

  async play(): Promise<void> {
    if (
      this.#disposed ||
      this.#playing ||
      this.#starting ||
      this.#duration === 0
    ) {
      return;
    }
    this.#starting = true;
    const generation = ++this.#generation;
    try {
      if (this.#position >= this.#duration) this.#position = 0;
      await this.#context.resume();
      if (this.#context.state !== "running") {
        throw new Error("浏览器阻止了播放，请再次点击“播放”");
      }
      this.#events.onStatus("buffering");
      await nextPaint();
      const [audioPlayback, videoPlayback] = await Promise.all([
        this.#primeAudio(this.#position),
        this.#primeVideo(this.#position),
      ]);
      if (
        this.#disposed ||
        this.#playing ||
        generation !== this.#generation
      ) {
        return;
      }
      this.#playing = true;
      this.#startedAt =
        this.#context.currentTime + STARTUP_BUFFER_SECONDS - this.#position;
      this.#events.onState(true);
      void this.#runVideo(generation, videoPlayback);
      void this.#runAudio(generation, audioPlayback);
      void this.#runClock(generation);
    } finally {
      this.#starting = false;
    }
  }

  pause(): void {
    if (!this.#playing) return;
    this.#position = this.#currentPosition();
    this.#playing = false;
    this.#generation += 1;
    this.#stopAudio();
    this.#events.onState(false);
    this.#events.onPosition(this.#position, this.#duration);
  }

  setVolume(value: number): void {
    this.#gain.gain.value = Math.min(1, Math.max(0, value));
  }

  setMuted(muted: boolean): void {
    this.#gain.gain.value = muted ? 0 : 1;
  }

  async seek(position: number): Promise<void> {
    if (this.#disposed || !Number.isFinite(position)) return;
    const target = Math.min(this.#duration, Math.max(0, position));
    const resume = this.#playing;
    const generation = ++this.#generation;
    if (this.#playing) {
      this.#playing = false;
      this.#events.onState(false);
      await this.#fadeOutAndStopAudio();
      if (generation !== this.#generation || this.#disposed) return;
    }
    this.#position = target;
    this.#events.onPosition(target, this.#duration);
    this.#events.onStatus("buffering");

    try {
      this.#cancelPendingReads();
      this.#input.dispose();
      this.#input = this.#createInput();
      await this.#configureInput(false);
      if (generation !== this.#generation || this.#disposed) return;
      if (resume) {
        await this.play();
      } else {
        const frame = await this.#videoSink?.getCanvas(target);
        if (generation !== this.#generation || this.#disposed) return;
        if (frame) this.#drawFrame(frame.canvas);
        this.#events.onStatus("ready");
      }
    } catch (error) {
      if (generation === this.#generation && !this.#disposed) {
        this.#events.onError(error);
      }
    }
  }

  async selectAudioTrack(trackNumber: number): Promise<void> {
    if (
      this.#disposed ||
      !Number.isSafeInteger(trackNumber) ||
      trackNumber < 1 ||
      trackNumber === this.#selectedAudioTrackNumber
    ) {
      return;
    }
    const previousTrackNumber = this.#selectedAudioTrackNumber;
    const resume = this.#playing;
    const position = this.#playing ? this.#currentPosition() : this.#position;
    const generation = ++this.#generation;
    this.#playing = false;
    this.#events.onState(false);
    await this.#fadeOutAndStopAudio();
    if (generation !== this.#generation || this.#disposed) return;
    this.#position = position;
    this.#selectedAudioTrackNumber = trackNumber;
    this.#events.onPosition(position, this.#duration);
    this.#events.onStatus("buffering");
    try {
      this.#input.dispose();
      this.#input = this.#createInput();
      await this.#configureInput(false);
      if (generation !== this.#generation || this.#disposed) return;
      if (resume) await this.play();
      else this.#events.onStatus("ready");
    } catch (error) {
      if (generation !== this.#generation || this.#disposed) return;
      this.#selectedAudioTrackNumber = previousTrackNumber;
      try {
        this.#input.dispose();
        this.#input = this.#createInput();
        await this.#configureInput(false);
      } catch {
        // Keep the original switching error as the useful failure.
      }
      this.#events.onError(error);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.pause();
    this.#disposed = true;
    this.#input.dispose();
    void this.#context.close();
  }

  async #runVideo(
    generation: number,
    playback: VideoPlayback | null,
  ): Promise<void> {
    if (!playback) return;
    const context = this.#canvas.getContext("2d");
    if (!context) {
      this.#events.onError(new Error("无法创建视频 Canvas"));
      return;
    }
    try {
      for await (const frame of playback.iterator) {
        if (!this.#isCurrent(generation)) return;
        await waitUntil(
          () => this.#currentPosition() >= frame.timestamp,
          () => this.#isCurrent(generation),
        );
        if (!this.#isCurrent(generation)) return;
        if (
          frame.timestamp + frame.duration <
          this.#currentPosition() - MAX_VIDEO_LATENESS_SECONDS
        ) {
          continue;
        }
        context.drawImage(
          frame.canvas,
          0,
          0,
          this.#canvas.width,
          this.#canvas.height,
        );
      }
    } catch (error) {
      if (this.#isCurrent(generation)) this.#fail(error);
    }
  }

  async #runAudio(
    generation: number,
    playback: AudioPlayback | null,
  ): Promise<void> {
    if (!playback) return;
    const startPosition = this.#position;
    try {
      for (const item of playback.primed) {
        if (!this.#scheduleAudioBuffer(item, startPosition, generation)) {
          return;
        }
      }
      for await (const item of playback.iterator) {
        if (!this.#isCurrent(generation)) return;
        while (
          item.timestamp - this.#currentPosition() > 2 &&
          this.#isCurrent(generation)
        ) {
          await delay(100);
        }
        if (!this.#scheduleAudioBuffer(item, startPosition, generation)) return;
      }
    } catch (error) {
      if (this.#isCurrent(generation)) this.#fail(error);
    }
  }

  async #primeAudio(position: number): Promise<AudioPlayback | null> {
    if (!this.#audioSink) return null;
    const iterator = this.#audioSink.buffers(position, this.#duration);
    const primed: WrappedAudioBuffer[] = [];
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      primed.push(next.value);
      const bufferedUntil = next.value.timestamp + next.value.duration;
      if (bufferedUntil - position >= AUDIO_PREROLL_SECONDS) break;
    }
    return { iterator, primed };
  }

  async #primeVideo(position: number): Promise<VideoPlayback | null> {
    if (!this.#videoSink) return null;
    const iterator = this.#videoSink.canvases(position, this.#duration);
    const first = await iterator.next();
    if (!first.done) this.#drawFrame(first.value.canvas);
    return { iterator };
  }

  #scheduleAudioBuffer(
    item: WrappedAudioBuffer,
    startPosition: number,
    generation: number,
  ): boolean {
    if (!this.#isCurrent(generation)) return false;
    const offset = getAudioBufferOffset(
      item.timestamp,
      item.buffer.duration,
      Math.max(startPosition, this.#currentPosition()),
    );
    if (offset === null) return true;
    const source = this.#context.createBufferSource();
    source.buffer = item.buffer;
    source.connect(this.#gain);
    source.onended = () => this.#audioSources.delete(source);
    this.#audioSources.add(source);
    const when = Math.max(
      this.#context.currentTime,
      this.#startedAt + item.timestamp + offset,
    );
    source.start(when, offset);
    return true;
  }

  async #runClock(generation: number): Promise<void> {
    let started = false;
    while (this.#isCurrent(generation)) {
      this.#position = this.#currentPosition();
      if (!started && this.#context.currentTime >= this.#startedAt) {
        started = true;
        this.#events.onStatus("playing");
      }
      this.#events.onPosition(this.#position, this.#duration);
      if (this.#position >= this.#duration) {
        this.#playing = false;
        this.#generation += 1;
        this.#stopAudio();
        this.#events.onState(false);
        return;
      }
      await delay(100);
    }
  }

  #currentPosition(): number {
    return Math.min(
      this.#duration,
      Math.max(0, this.#context.currentTime - this.#startedAt),
    );
  }

  async #prepareFirstSamples(): Promise<void> {
    const [frame] = await Promise.all([
      this.#videoSink?.getCanvas(0) ?? null,
      this.#audioSink?.getBuffer(0) ?? null,
    ]);
    if (!frame) return;
    this.#drawFrame(frame.canvas);
  }

  async #configureInput(updateDuration: boolean): Promise<void> {
    const [videoTrack, primaryAudioTrack, audioTracks] = await Promise.all([
      this.#input.getPrimaryVideoTrack(),
      this.#input.getPrimaryAudioTrack(),
      this.#input.getAudioTracks(),
    ]);
    let duration: number | null = null;
    if (updateDuration) {
      duration = await this.#input.getDurationFromMetadata();
      if (duration === null) {
        duration = await this.#input.computeDuration();
      }
    }
    const audioTrack =
      this.#selectedAudioTrackNumber === undefined
        ? primaryAudioTrack
        : findAudioTrackByNumber(
            audioTracks,
            this.#selectedAudioTrackNumber,
          );
    if (
      this.#selectedAudioTrackNumber !== undefined &&
      audioTrack === undefined
    ) {
      throw new Error("所选音轨在重建后的媒体输入中不存在");
    }
    this.#selectedAudioTrackNumber = audioTrack?.number;
    this.#videoSink = videoTrack
      ? new CanvasSink(videoTrack, {
          poolSize: 3,
          decoderOptions: { optimizeForLatency: true },
        })
      : null;
    this.#audioSink = audioTrack ? new AudioBufferSink(audioTrack) : null;
    if (videoTrack) {
      this.#canvas.width = await videoTrack.getDisplayWidth();
      this.#canvas.height = await videoTrack.getDisplayHeight();
    }
    if (updateDuration) this.#duration = Math.max(0, duration ?? 0);
  }

  #drawFrame(frame: HTMLCanvasElement | OffscreenCanvas): void {
    const context = this.#canvas.getContext("2d");
    if (!context) throw new Error("无法创建视频 Canvas");
    context.drawImage(frame, 0, 0, this.#canvas.width, this.#canvas.height);
  }

  #isCurrent(generation: number): boolean {
    return !this.#disposed && this.#playing && generation === this.#generation;
  }

  #stopAudio(): void {
    for (const source of this.#audioSources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.#audioSources.clear();
  }

  async #fadeOutAndStopAudio(): Promise<void> {
    if (this.#audioSources.size === 0) return;
    const now = this.#context.currentTime;
    const restore = this.#gain.gain.value;
    this.#gain.gain.cancelScheduledValues(now);
    this.#gain.gain.setValueAtTime(restore, now);
    this.#gain.gain.linearRampToValueAtTime(0, now + 0.02);
    await delay(24);
    this.#stopAudio();
    this.#gain.gain.cancelScheduledValues(this.#context.currentTime);
    this.#gain.gain.setValueAtTime(restore, this.#context.currentTime);
  }

  #fail(error: unknown): void {
    this.pause();
    this.#events.onError(error);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntil(
  ready: () => boolean,
  active: () => boolean,
): Promise<void> {
  while (!ready() && active()) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

interface AudioPlayback {
  iterator: AsyncGenerator<WrappedAudioBuffer, void, unknown>;
  primed: WrappedAudioBuffer[];
}

interface VideoPlayback {
  iterator: AsyncGenerator<WrappedCanvas, void, unknown>;
}

export function getAudioBufferOffset(
  timestamp: number,
  duration: number,
  position: number,
): number | null {
  const offset = Math.max(0, position - timestamp);
  return offset >= duration ? null : offset;
}

export function findAudioTrackByNumber<T extends { number: number }>(
  tracks: readonly T[],
  trackNumber: number,
): T | undefined {
  return tracks.find((track) => track.number === trackNumber);
}
