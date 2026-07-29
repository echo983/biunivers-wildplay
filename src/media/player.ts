import {
  AudioBufferSink,
  CanvasSink,
  type Input,
  type Source,
} from "mediabunny";

export interface MediaPlayerEvents {
  onPosition(position: number, duration: number): void;
  onState(playing: boolean): void;
  onStatus(status: "buffering" | "playing"): void;
  onError(error: unknown): void;
}

const STARTUP_BUFFER_SECONDS = 0.7;

export class MediaPlayer {
  readonly #canvas: HTMLCanvasElement;
  readonly #events: MediaPlayerEvents;
  readonly #context = new AudioContext();
  readonly #gain = this.#context.createGain();
  readonly #audioSources = new Set<AudioBufferSourceNode>();
  #videoSink: CanvasSink | null = null;
  #audioSink: AudioBufferSink | null = null;
  #duration = 0;
  #position = 0;
  #startedAt = 0;
  #generation = 0;
  #playing = false;
  #starting = false;
  #disposed = false;

  private constructor(
    canvas: HTMLCanvasElement,
    events: MediaPlayerEvents,
  ) {
    this.#canvas = canvas;
    this.#events = events;
    this.#gain.connect(this.#context.destination);
  }

  static async create(
    input: Input<Source>,
    canvas: HTMLCanvasElement,
    events: MediaPlayerEvents,
  ): Promise<MediaPlayer> {
    const player = new MediaPlayer(canvas, events);
    try {
      const [videoTrack, audioTrack, duration] = await Promise.all([
        input.getPrimaryVideoTrack(),
        input.getPrimaryAudioTrack(),
        input.getDurationFromMetadata(),
      ]);
      if (videoTrack) {
        player.#videoSink = new CanvasSink(videoTrack, { poolSize: 3 });
        player.#canvas.width = await videoTrack.getDisplayWidth();
        player.#canvas.height = await videoTrack.getDisplayHeight();
      }
      if (audioTrack) player.#audioSink = new AudioBufferSink(audioTrack);
      player.#duration = Math.max(0, duration ?? 0);
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
    try {
      if (this.#position >= this.#duration) this.#position = 0;
      await this.#context.resume();
      if (this.#context.state !== "running") {
        throw new Error("浏览器阻止了播放，请再次点击“播放”");
      }
      this.#events.onStatus("buffering");
      await nextPaint();
      if (this.#disposed || this.#playing) return;
      this.#playing = true;
      this.#startedAt =
        this.#context.currentTime + STARTUP_BUFFER_SECONDS - this.#position;
      const generation = ++this.#generation;
      this.#events.onState(true);
      void this.#runVideo(generation);
      void this.#runAudio(generation);
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

  dispose(): void {
    if (this.#disposed) return;
    this.pause();
    this.#disposed = true;
    void this.#context.close();
  }

  async #runVideo(generation: number): Promise<void> {
    if (!this.#videoSink) return;
    const context = this.#canvas.getContext("2d");
    if (!context) {
      this.#events.onError(new Error("无法创建视频 Canvas"));
      return;
    }
    try {
      for await (const frame of this.#videoSink.canvases(
        this.#position,
        this.#duration,
      )) {
        if (!this.#isCurrent(generation)) return;
        await waitUntil(
          () => this.#currentPosition() >= frame.timestamp,
          () => this.#isCurrent(generation),
        );
        if (!this.#isCurrent(generation)) return;
        context.drawImage(frame.canvas, 0, 0, this.#canvas.width, this.#canvas.height);
      }
    } catch (error) {
      if (this.#isCurrent(generation)) this.#fail(error);
    }
  }

  async #runAudio(generation: number): Promise<void> {
    if (!this.#audioSink) return;
    const startPosition = this.#position;
    try {
      for await (const item of this.#audioSink.buffers(
        startPosition,
        this.#duration,
      )) {
        if (!this.#isCurrent(generation)) return;
        while (
          item.timestamp - this.#currentPosition() > 2 &&
          this.#isCurrent(generation)
        ) {
          await delay(100);
        }
        if (!this.#isCurrent(generation)) return;
        const source = this.#context.createBufferSource();
        source.buffer = item.buffer;
        source.connect(this.#gain);
        source.onended = () => this.#audioSources.delete(source);
        this.#audioSources.add(source);
        const offset = Math.max(0, startPosition - item.timestamp);
        if (offset >= item.buffer.duration) continue;
        const when = Math.max(
          this.#context.currentTime,
          this.#startedAt + item.timestamp + offset,
        );
        source.start(when, offset);
      }
    } catch (error) {
      if (this.#isCurrent(generation)) this.#fail(error);
    }
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
    const context = this.#canvas.getContext("2d");
    if (!context) throw new Error("无法创建视频 Canvas");
    context.drawImage(
      frame.canvas,
      0,
      0,
      this.#canvas.width,
      this.#canvas.height,
    );
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
