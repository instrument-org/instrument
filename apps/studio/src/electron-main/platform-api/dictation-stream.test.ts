import { type DictationStreamEvent } from "@/shared/dictation";
import { createServer } from "node:http";
import { type AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";

import { platformApiBaseUrl } from "./base-url";
import { dictationAllowance } from "./dictation";
import {
  feedDictation,
  finishDictation,
  listenForDictation,
} from "./dictation-stream";
import { getToken } from "./utils";

vi.mock(import("./headers"), () => ({
  getPlatformApiHeaders: () => ({
    authorization: "Bearer test-token",
    "user-agent": "Instrument/1.4.2",
    "x-client-arch": "arm64",
    "x-client-name": "studio",
    "x-client-os-version": "15.6",
    "x-client-platform": "darwin",
    "x-client-version": "1.4.2",
  }),
}));
vi.mock(import("./utils"), () => ({ getToken: vi.fn() }));
vi.mock(import("./base-url"), () => ({ platformApiBaseUrl: vi.fn() }));

const mockGetToken = vi.mocked(getToken);
const mockPlatformApiBaseUrl = vi.mocked(platformApiBaseUrl);

/**
 * A stand-in for the API's stream route: it records what it was sent and
 * how it was asked, and answers the way `answer` says.
 */
async function fakeApi(
  answer: "allowance" | "words" | ((socket: import("ws").WebSocket) => void),
) {
  const received: (number | string)[] = [];
  const asked: { headers: Record<string, unknown>; url?: string }[] = [];
  const http = createServer();
  const server = new WebSocketServer({ noServer: true });
  http.on("upgrade", (request, socket, head) => {
    asked.push({ headers: request.headers, url: request.url });
    if (answer === "allowance") {
      // As the API refuses before upgrading: a typed error body.
      const body = JSON.stringify({
        error: {
          code: "dictation-allowance-reached",
          resetsAt: "2026-10-16T00:00:00.000Z",
        },
      });
      socket.end(
        `HTTP/1.1 429 Too Many Requests\r\ncontent-type: application/json\r\ncontent-length: ${body.length}\r\n\r\n${body}`,
      );
      return;
    }
    server.handleUpgrade(request, socket, head, (ws) => {
      server.emit("connection", ws, request);
    });
  });
  server.on("connection", (socket: import("ws").WebSocket) => {
    if (typeof answer === "function") {
      answer(socket);
      return;
    }
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        received.push((data as Buffer).byteLength);
        socket.send(
          JSON.stringify({ final: false, text: "Book a", type: "text" }),
        );
        return;
      }
      received.push((data as Buffer).toString());
      socket.send(
        JSON.stringify({ final: true, text: "Book a table.", type: "text" }),
      );
      socket.send(
        JSON.stringify({
          audioSeconds: 2,
          complete: true,
          reason: "stopped",
          type: "end",
        }),
      );
      socket.close(1000, "stopped");
    });
  });
  await new Promise<void>((resolve) => {
    http.listen(0, "127.0.0.1", resolve);
  });
  // `as`: listening on a port, so the address is an AddressInfo.
  const { port } = http.address() as AddressInfo;
  mockPlatformApiBaseUrl.mockReturnValue(`http://127.0.0.1:${port}`);
  return {
    asked,
    close: () =>
      new Promise((resolve) => {
        server.close();
        http.close(resolve);
      }),
    received,
  };
}

/** Runs a stream to its end, feeding it `chunks` and Stop once it opens. */
async function listen(chunks: string[], { stop = true } = {}) {
  const events: DictationStreamEvent[] = [];
  for await (const event of listenForDictation({
    language: "en",
    surface: "composer",
  })) {
    events.push(event);
    if (event.type === "open") {
      for (const chunk of chunks) {
        feedDictation(event.id, new Blob([chunk]));
      }
      if (stop) {
        finishDictation(event.id);
      }
    }
  }
  return events.map((event) =>
    event.type === "open" ? { ...event, id: "<id>" } : event,
  );
}

let api: Awaited<ReturnType<typeof fakeApi>> | undefined;

beforeEach(() => {
  mockGetToken.mockReturnValue("test-token");
});
afterEach(async () => {
  await api?.close();
  api = undefined;
});

describe("listenForDictation", () => {
  it("is unavailable without asking when signed out", async () => {
    mockGetToken.mockReturnValue(undefined);

    expect(await listen([])).toEqual([
      { failure: { kind: "signed-out" }, type: "unavailable" },
    ]);
  });

  it("streams the take in order, then Stop, and reports what was heard", async () => {
    api = await fakeApi("words");

    const events = await listen(["header", "more"]);

    expect(api.asked[0]?.url).toBe("/dictation/stream?language=en");
    expect(api.asked[0]?.headers).toMatchObject({
      authorization: "Bearer test-token",
      "x-instrument-dictation-surface": "composer",
    });
    expect(api.received).toEqual([6, 4, '{"type":"stop"}']);
    expect(events).toMatchInlineSnapshot(`
      [
        {
          "id": "<id>",
          "type": "open",
        },
        {
          "final": false,
          "text": "Book a",
          "type": "text",
        },
        {
          "final": false,
          "text": "Book a",
          "type": "text",
        },
        {
          "final": true,
          "text": "Book a table.",
          "type": "text",
        },
        {
          "complete": true,
          "reason": "stopped",
          "type": "end",
        },
      ]
    `);
  });

  it("says the allowance is used up when the API refuses the socket for it", async () => {
    api = await fakeApi("allowance");

    const events = await listen([]);

    expect(events).toMatchInlineSnapshot(`
      [
        {
          "failure": {
            "kind": "allowance-reached",
            "resetsAt": "2026-10-16T00:00:00.000Z",
          },
          "type": "unavailable",
        },
      ]
    `);
  });

  it("reports a stream that closed before its end as lost", async () => {
    api = await fakeApi((socket) => {
      socket.close(1011, "");
    });

    expect(await listen([], { stop: false })).toEqual([
      { id: "<id>", type: "open" },
      { type: "lost" },
    ]);
  });

  it("is unavailable when the API can't be reached", async () => {
    mockPlatformApiBaseUrl.mockReturnValue("http://127.0.0.1:1");

    expect(await listen([])).toEqual([
      { failure: { kind: "connection" }, type: "unavailable" },
    ]);
  });

  it("keeps the allowance used up once a stream ends at it", async () => {
    const resetsAt = new Date(Date.now() + 60_000).toISOString();
    api = await fakeApi((socket) => {
      socket.send(
        JSON.stringify({
          audioSeconds: 3,
          complete: true,
          reason: "allowance",
          resetsAt,
          type: "end",
        }),
      );
      socket.close(1000, "allowance");
    });

    await listen([], { stop: false });

    expect(dictationAllowance()).toEqual({ exhausted: true, resetsAt });
  });
});
