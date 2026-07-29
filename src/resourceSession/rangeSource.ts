import {
  ResourceSessionError,
  type ResourceSession,
} from "./types";

export interface ResourceRangeSourceOptions {
  fetch?: typeof fetch;
  maxConcurrent?: number;
}

export class ResourceRangeSource {
  readonly size: number;
  readonly #fetch: typeof fetch;
  readonly #maxConcurrent: number;
  readonly #inFlight = new Map<string, Promise<Uint8Array>>();
  readonly #controllers = new Set<AbortController>();
  readonly #waiters: Array<() => void> = [];
  #active = 0;
  #closed = false;

  constructor(
    readonly session: ResourceSession,
    options: ResourceRangeSourceOptions = {},
  ) {
    this.size = session.metadata.size;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#maxConcurrent = options.maxConcurrent ?? 4;
    if (
      !Number.isSafeInteger(this.size) ||
      this.size < 0 ||
      !Number.isSafeInteger(this.#maxConcurrent) ||
      this.#maxConcurrent < 1
    ) {
      throw new ResourceSessionError(
        "RESOURCE_METADATA_INVALID",
        "资源大小或并发限制无效",
      );
    }
  }

  read(start: number, endExclusive: number): Promise<Uint8Array> {
    this.#validateRange(start, endExclusive);
    const key = `${start}:${endExclusive}`;
    const existing = this.#inFlight.get(key);
    if (existing) return existing;
    let request: Promise<Uint8Array>;
    request = this.#read(start, endExclusive).finally(() => {
      if (this.#inFlight.get(key) === request) {
        this.#inFlight.delete(key);
      }
    });
    this.#inFlight.set(key, request);
    return request;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const controller of this.#controllers) controller.abort();
    for (const wake of this.#waiters.splice(0)) wake();
  }

  cancelPending(): void {
    for (const controller of this.#controllers) controller.abort();
    this.#inFlight.clear();
  }

  async #read(start: number, endExclusive: number): Promise<Uint8Array> {
    await this.#acquire();
    if (this.#closed) throw closed();
    const controller = new AbortController();
    this.#controllers.add(controller);
    try {
      const response = await this.#fetch(this.session.content.url, {
        headers: {
          Authorization:
            `${this.session.content.authorization} ${this.session.content.instanceToken}`,
          [this.session.content.sessionHeader]: this.session.sessionId,
          Range: `bytes=${start}-${endExclusive - 1}`,
        },
        signal: controller.signal,
      });
      if (response.status !== 206) {
        throw await responseError(response);
      }
      const expectedLength = endExclusive - start;
      const expectedRange = `bytes ${start}-${endExclusive - 1}/${this.size}`;
      if (
        response.headers.get("content-range") !== expectedRange ||
        Number(response.headers.get("content-length")) !== expectedLength
      ) {
        throw new ResourceSessionError(
          "RESOURCE_RANGE_INVALID",
          "宿主返回了不一致的 Range 响应头",
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== expectedLength) {
        throw new ResourceSessionError(
          "RESOURCE_RANGE_INVALID",
          "宿主返回了不一致的 Range 响应长度",
        );
      }
      return bytes;
    } finally {
      this.#controllers.delete(controller);
      this.#release();
    }
  }

  #validateRange(start: number, endExclusive: number): void {
    if (
      this.#closed ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(endExclusive) ||
      start < 0 ||
      endExclusive <= start ||
      endExclusive > this.size
    ) {
      throw new ResourceSessionError(
        this.#closed ? "RESOURCE_SOURCE_CLOSED" : "RESOURCE_RANGE_INVALID",
        this.#closed ? "资源读取器已关闭" : "请求的字节区间无效",
      );
    }
  }

  async #acquire(): Promise<void> {
    if (this.#active < this.#maxConcurrent) {
      this.#active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.#waiters.push(resolve));
    if (this.#closed) throw closed();
  }

  #release(): void {
    const next = this.#waiters.shift();
    if (next) {
      next();
    } else {
      this.#active -= 1;
    }
  }
}

async function responseError(response: Response): Promise<ResourceSessionError> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    value = null;
  }
  const error =
    typeof value === "object" && value !== null && "error" in value
      ? (value.error as { code?: unknown; message?: unknown })
      : {};
  return new ResourceSessionError(
    typeof error.code === "string"
      ? error.code
      : "RESOURCE_RANGE_FAILED",
    typeof error.message === "string"
      ? error.message
      : `资源读取失败：HTTP ${response.status}`,
  );
}

function closed(): ResourceSessionError {
  return new ResourceSessionError(
    "RESOURCE_SOURCE_CLOSED",
    "资源读取器已关闭",
  );
}
