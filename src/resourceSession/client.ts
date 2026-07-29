import { ResourceProtocolTransport } from "./protocol";
import type {
  ResourceCapabilities,
  ResourceLaunch,
  ResourceRenewalResult,
  ResourceSession,
} from "./types";

export class ResourceSessionClient {
  readonly #active = new Set<string>();
  readonly #renewTimer: ReturnType<typeof setInterval>;

  constructor(
    readonly transport = new ResourceProtocolTransport(),
    renewEveryMs = 60_000,
  ) {
    this.#renewTimer = setInterval(() => void this.#renewActive(), renewEveryMs);
  }

  capabilities(): Promise<ResourceCapabilities> {
    return this.transport.request("resource.getCapabilities", {}, 1_200);
  }

  async claimLaunch(): Promise<ResourceLaunch> {
    const launch = await this.transport.request<ResourceLaunch>(
      "resource.claimLaunch",
    );
    this.track(launch.resource);
    return launch;
  }

  async open(): Promise<ResourceSession> {
    const session = await this.transport.request<ResourceSession>(
      "resource.open",
      { access: "read" },
    );
    this.track(session);
    return session;
  }

  track(session: ResourceSession): void {
    this.#active.add(session.sessionId);
  }

  async release(session: ResourceSession): Promise<void> {
    this.#active.delete(session.sessionId);
    await this.transport.request("resource.release", {
      sessionIds: [session.sessionId],
    });
  }

  onLaunchAvailable(listener: () => void): () => void {
    return this.transport.onLaunchAvailable(listener);
  }

  dispose(): void {
    clearInterval(this.#renewTimer);
    const sessionIds = [...this.#active];
    this.#active.clear();
    if (sessionIds.length > 0) {
      void this.transport.request("resource.release", { sessionIds });
    }
    this.transport.dispose();
  }

  async #renewActive(): Promise<void> {
    const sessionIds = [...this.#active];
    if (sessionIds.length === 0) return;
    try {
      const result =
        await this.transport.request<ResourceRenewalResult>(
          "resource.renew",
          { sessionIds },
        );
      for (const rejected of result.rejected) {
        this.#active.delete(rejected.sessionId);
      }
    } catch {
      // A transient failure is retried at the next interval. The 300-second
      // host lease allows several missed 60-second renewals.
    }
  }
}
