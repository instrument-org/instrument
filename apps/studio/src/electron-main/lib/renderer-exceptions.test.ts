import { serializeError } from "@instrument-org/shared/exceptions";
import { describe, expect, it, vi } from "vitest";

const { buildMainExceptionEvent, handlers, recordExceptionEvent } = vi.hoisted(
  () => ({
    buildMainExceptionEvent: vi.fn(() => ({ fingerprint: "f".repeat(32), id: "1".repeat(32) })),
    handlers: new Map<string, (event: unknown, payload: unknown) => unknown>(),
    recordExceptionEvent: vi.fn(),
  }),
);

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload: unknown) => unknown) => {
      handlers.set(channel, handler);
    },
  },
}));
vi.mock("./capture-server-exception", () => ({
  buildMainExceptionEvent,
  recordExceptionEvent,
}));

const { serveRendererExceptions } = await import("./renderer-exceptions");
serveRendererExceptions();
const capture = (payload: unknown) =>
  handlers.get("capture-exception")?.({}, payload);

describe("serveRendererExceptions", () => {
  it("builds a renderer capture as a forwarded exception and answers its names", () => {
    const error = serializeError(new TypeError("x is undefined"));
    const answer = capture({ context: { mechanism: "error-boundary" }, error });

    expect(buildMainExceptionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ process: "renderer", serialized: error }),
      { mechanism: "error-boundary" },
    );
    expect(recordExceptionEvent).toHaveBeenCalledOnce();
    expect(answer).toEqual({ fingerprint: "f".repeat(32), id: "1".repeat(32) });
  });

  it("refuses a payload that is not a serialized error", () => {
    expect(capture({ error: "boom" })).toBeNull();
  });
});
