import { type ExceptionEvent } from "@instrument-org/shared/exceptions";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { logger, storeExceptionEvent, unreachable } = vi.hoisted(() => ({
  logger: { error: vi.fn() },
  storeExceptionEvent: vi.fn<(event: ExceptionEvent) => void>(),
  unreachable: { value: false },
}));

vi.mock("electron", () => ({
  app: {
    getAppPath: () =>
      "/Applications/Instrument.app/Contents/Resources/app.asar",
  },
}));
vi.mock("@/electron-main/platform-api/reachability", () => ({
  isPlatformApiUnreachable: () => unreachable.value,
}));
vi.mock("./electron-logger", () => ({ logger }));
vi.mock("./renderer-host", () => ({
  rendererBaseURL: () => "instrument://app/",
}));
vi.mock("./exception-store", () => ({ storeExceptionEvent }));
vi.mock("./event-contexts", () => ({
  eventContexts: () => ({
    app: {
      channel: "latest",
      flavor: "release",
      packaged: true,
      version: "2.0.0",
    },
    culture: { locale: "en-US", timeZone: "UTC" },
    os: { arch: "arm64", platform: "darwin", version: "26.1" },
    process: { rssMb: 400, uptimeMs: 1000 },
    runtime: { chrome: "1", electron: "1", node: "1" },
  }),
}));

const { captureFor, captureServerException } =
  await import("./capture-server-exception");
const { ForwardedException, serializeError } =
  await import("@instrument-org/shared/exceptions");

// Recorded from a task that hit this: OpenRouter reports upstream throttling as
// one chunk in an otherwise successful stream, and the chunk is thrown verbatim
// rather than as an `Error`.
const STREAMED_THROTTLE = {
  code: 429,
  message: "openai/gpt-5.6-luna is temporarily rate-limited upstream.",
  metadata: { error_type: "rate_limit_exceeded" },
};

const stored = () => storeExceptionEvent.mock.lastCall?.[0];

describe("captureServerException", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unreachable.value = false;
  });

  it("keeps a thrown non-Error whole, under a sentence that says what it was", () => {
    captureServerException(STREAMED_THROTTLE);

    expect(stored()).toMatchObject({
      area: "studio",
      exceptions: [
        {
          data: { __serialized__: STREAMED_THROTTLE },
          mechanism: { synthetic: true },
          value: "openai/gpt-5.6-luna is temporarily rate-limited upstream.",
        },
      ],
    });
  });

  it("records the caller's context and logs the readable event", () => {
    const error = new Error("plain failure");

    captureServerException(error, { mechanism: "rpc", rpcPath: "task.create" });

    expect(stored()).toMatchObject({
      context: { rpcPath: "task.create" },
      handled: true,
      mechanism: "rpc",
      process: "main",
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[Exception\] \[studio, rpc, handled, error, main\].*\nError: plain failure\n {2}at /,
      ),
    );
  });

  it("names the binding's area unless the caller names another", () => {
    const capture = captureFor("workspace");
    capture(new Error("x"));
    expect(stored()?.area).toBe("workspace");
    capture(new Error("x"), { area: "llm-request" });
    expect(stored()?.area).toBe("llm-request");
  });

  it("reads a forwarded error as the process that threw it", () => {
    captureServerException(
      new ForwardedException(
        serializeError(new Error("worker")),
        "bash-worker",
      ),
    );
    expect(stored()?.process).toBe("bash-worker");
  });

  it("names a renderer frame by its place in the renderer", () => {
    const error = new Error("render");
    error.stack =
      "Error: render\n    at Chat (instrument://app/assets/chat-AbCd1234.js:10:5)";
    captureServerException(
      new ForwardedException(serializeError(error), "renderer"),
    );
    expect(stored()?.exceptions[0]?.frames[0]).toMatchObject({
      filename: "app:///assets/chat-AbCd1234.js",
      inApp: true,
      module: "assets/chat",
    });
  });

  it("leaves out a network drop while the platform API is unreachable", () => {
    unreachable.value = true;
    captureServerException(
      new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }),
    );
    expect(storeExceptionEvent).not.toHaveBeenCalled();
  });

  it("never throws for its caller", () => {
    storeExceptionEvent.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    expect(() => {
      captureServerException(new Error("x"));
    }).not.toThrow();
  });
});
