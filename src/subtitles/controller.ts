import {
  loadSubtitleWindow,
  probeMatroskaSubtitles,
  type MatroskaSubtitleIndex,
  type MatroskaSubtitleTrack,
  type RandomAccessReader,
  type SubtitleCue,
} from "./matroska";

export interface SubtitleControllerEvents {
  onTracks(tracks: MatroskaSubtitleTrack[]): void;
  onSelection(trackNumber: number | undefined): void;
  onError(error: unknown): void;
}

export class SubtitleController {
  readonly #source: RandomAccessReader;
  readonly #overlay: HTMLElement;
  readonly #events: SubtitleControllerEvents;
  #index: MatroskaSubtitleIndex | undefined;
  #selected: MatroskaSubtitleTrack | undefined;
  #cues: SubtitleCue[] = [];
  #generation = 0;
  #position = 0;
  #loading = false;
  #loadedUntil = -1;
  #disposed = false;

  constructor(
    source: RandomAccessReader,
    overlay: HTMLElement,
    events: SubtitleControllerEvents,
  ) {
    this.#source = source;
    this.#overlay = overlay;
    this.#events = events;
  }

  get tracks(): readonly MatroskaSubtitleTrack[] {
    return this.#index?.tracks ?? [];
  }

  get selectedTrackNumber(): number | undefined {
    return this.#selected?.number;
  }

  async initialize(): Promise<void> {
    try {
      const index = await probeMatroskaSubtitles(this.#source);
      if (this.#disposed) return;
      this.#index = index;
      this.#events.onTracks(index?.tracks ?? []);
    } catch (error) {
      if (!this.#disposed) this.#events.onError(error);
    }
  }

  select(trackNumber: number | undefined): void {
    this.#generation += 1;
    this.#loading = false;
    this.#cues = [];
    this.#loadedUntil = -1;
    this.#selected =
      trackNumber === undefined
        ? undefined
        : this.#index?.tracks.find(
            (track) => track.number === trackNumber && track.supported,
          );
    this.#overlay.textContent = "";
    this.#overlay.hidden = true;
    this.#events.onSelection(this.#selected?.number);
    if (this.#selected) void this.#load();
  }

  updatePosition(position: number): void {
    this.#position = position;
    const cue = this.#cues.find(
      (candidate) => candidate.start <= position && position < candidate.end,
    );
    this.#overlay.textContent = cue?.text ?? "";
    this.#overlay.hidden = !cue?.text;
    if (
      this.#selected &&
      !this.#loading &&
      (this.#loadedUntil < 0 || position > this.#loadedUntil - 10)
    ) {
      void this.#load();
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#generation += 1;
    this.#selected = undefined;
    this.#cues = [];
    this.#overlay.textContent = "";
    this.#overlay.hidden = true;
  }

  async #load(): Promise<void> {
    const index = this.#index;
    const track = this.#selected;
    if (!index || !track || this.#loading || this.#disposed) return;
    const generation = this.#generation;
    const position = this.#position;
    this.#loading = true;
    try {
      const cues = await loadSubtitleWindow(
        this.#source,
        index,
        track,
        position,
      );
      if (
        this.#disposed ||
        generation !== this.#generation ||
        track !== this.#selected
      ) {
        return;
      }
      this.#cues = cues;
      this.#loadedUntil = Math.max(position + 15, ...cues.map((cue) => cue.end));
      this.updatePosition(this.#position);
    } catch (error) {
      if (generation === this.#generation && !this.#disposed) {
        this.#events.onError(error);
      }
    } finally {
      if (generation === this.#generation) this.#loading = false;
    }
  }
}
