import {
  RESOURCE_SESSION_PROTOCOL,
  ResourceSessionError,
} from "./types";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: ResourceSessionError) => void;
  timeout: ReturnType<typeof setTimeout> | null;
}

export interface ResourceProtocolTransportOptions {
  hostWindow?: Window;
  hostOrigin?: string;
}

export class ResourceProtocolTransport {
  readonly #hostWindow: Window;
  readonly #hostOrigin: string;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #launchListeners = new Set<() => void>();
  readonly #receive = (event: MessageEvent<unknown>) => {
    if (
      event.source !== this.#hostWindow ||
      event.origin !== this.#hostOrigin ||
      !isRecord(event.data) ||
      event.data.protocol !== RESOURCE_SESSION_PROTOCOL
    ) {
      return;
    }
    if (event.data.event === "launch.contextAvailable") {
      for (const listener of this.#launchListeners) listener();
      return;
    }
    if (typeof event.data.requestId !== "string") return;
    const pending = this.#pending.get(event.data.requestId);
    if (!pending) return;
    this.#pending.delete(event.data.requestId);
    if (pending.timeout) clearTimeout(pending.timeout);
    if (event.data.ok === true) {
      pending.resolve(event.data.result);
      return;
    }
    const error = isRecord(event.data.error) ? event.data.error : {};
    pending.reject(
      new ResourceSessionError(
        typeof error.code === "string"
          ? error.code
          : "RESOURCE_SESSION_FAILED",
        typeof error.message === "string"
          ? error.message
          : "Resource Session 请求失败",
      ),
    );
  };

  constructor(options: ResourceProtocolTransportOptions = {}) {
    this.#hostWindow = options.hostWindow ?? window.parent;
    this.#hostOrigin = options.hostOrigin ?? resolveHostOrigin();
    window.addEventListener("message", this.#receive);
  }

  request<T>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<T> {
    const requestId = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timeout =
        timeoutMs === undefined
          ? null
          : setTimeout(() => {
              this.#pending.delete(requestId);
              reject(
                new ResourceSessionError(
                  "RESOURCE_SESSION_UNSUPPORTED",
                  "宿主未响应 Resource Session v1",
                ),
              );
            }, timeoutMs);
      this.#pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      this.#hostWindow.postMessage(
        {
          protocol: RESOURCE_SESSION_PROTOCOL,
          requestId,
          method,
          params,
        },
        this.#hostOrigin,
      );
    });
  }

  onLaunchAvailable(listener: () => void): () => void {
    this.#launchListeners.add(listener);
    return () => this.#launchListeners.delete(listener);
  }

  dispose(): void {
    window.removeEventListener("message", this.#receive);
    const error = new ResourceSessionError(
      "CLIENT_DISPOSED",
      "Resource Session 客户端已关闭",
    );
    for (const pending of this.#pending.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
    this.#launchListeners.clear();
  }
}

function resolveHostOrigin(): string {
  if (!document.referrer) {
    throw new ResourceSessionError(
      "HOST_ORIGIN_UNAVAILABLE",
      "无法确认 Biunivers 宿主来源",
    );
  }
  return new URL(document.referrer).origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
