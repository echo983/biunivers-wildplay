import { describe, expect, it, vi } from "vitest";
import { ResourceRangeSource } from "./rangeSource";
import type { ResourceSession } from "./types";

const session: ResourceSession = {
  sessionId: "s".repeat(43),
  access: "read",
  expiresAt: "2026-07-29T20:00:00.000Z",
  metadata: {
    name: "movie.mkv",
    size: 100,
    mtimeMs: 1,
    mediaType: "video/x-matroska",
    contentVersion: "v".repeat(43),
  },
  content: {
    url: "http://localhost:8080/api/v1/resource-content",
    sessionHeader: "Biunivers-Resource-Session",
    authorization: "Biunivers-Instance",
    instanceToken: "i".repeat(43),
  },
};

describe("ResourceRangeSource", () => {
  it("maps an exclusive byte range to an authenticated 206 request", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("range")).toBe("bytes=10-19");
      expect(headers.get("biunivers-resource-session")).toBe(session.sessionId);
      expect(headers.get("authorization")).toBe(
        `Biunivers-Instance ${session.content.instanceToken}`,
      );
      return rangeResponse(10, 19, 100);
    });
    const source = new ResourceRangeSource(session, { fetch: fetchMock });
    await expect(source.read(10, 20)).resolves.toEqual(
      new Uint8Array(10),
    );
  });

  it("deduplicates identical in-flight reads", async () => {
    let complete!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
    const source = new ResourceRangeSource(session, { fetch: fetchMock });
    const first = source.read(0, 4);
    const second = source.read(0, 4);
    expect(first).toBe(second);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    complete(rangeResponse(0, 3, 100));
    await expect(first).resolves.toEqual(new Uint8Array(4));
  });

  it("enforces concurrency and starts the next queued range", async () => {
    const completions: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          completions.push(resolve);
        }),
    );
    const source = new ResourceRangeSource(session, {
      fetch: fetchMock,
      maxConcurrent: 1,
    });
    const first = source.read(0, 2);
    const second = source.read(2, 4);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    completions[0]!(rangeResponse(0, 1, 100));
    await first;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    completions[1]!(rangeResponse(2, 3, 100));
    await second;
  });

  it("aborts stale reads and allows the same range to be retried", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        if (fetchMock.mock.calls.length === 1) {
          await new Promise<void>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }
        return rangeResponse(0, 3, 100);
      },
    );
    const source = new ResourceRangeSource(session, { fetch: fetchMock });
    const stale = source.read(0, 4);
    const staleResult = expect(stale).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    source.cancelPending();
    await staleResult;
    await expect(source.read(0, 4)).resolves.toEqual(new Uint8Array(4));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid requests and inconsistent response headers", async () => {
    const source = new ResourceRangeSource(session, {
      fetch: vi.fn(async () =>
        rangeResponse(0, 8, 100),
      ),
    });
    expect(() => source.read(-1, 2)).toThrowError(
      expect.objectContaining({ code: "RESOURCE_RANGE_INVALID" }),
    );
    await expect(source.read(0, 10)).rejects.toMatchObject({
      code: "RESOURCE_RANGE_INVALID",
    });
    source.close();
    expect(() => source.read(0, 1)).toThrowError(
      expect.objectContaining({ code: "RESOURCE_SOURCE_CLOSED" }),
    );
  });
});

function rangeResponse(start: number, end: number, size: number): Response {
  return new Response(new Uint8Array(end - start + 1), {
    status: 206,
    headers: {
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
    },
  });
}
