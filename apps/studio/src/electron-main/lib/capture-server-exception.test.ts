import { noop } from "radashi";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { addServerException, captureException, logger } = vi.hoisted(() => ({
  addServerException: vi.fn(),
  captureException: vi.fn(),
  logger: { error: vi.fn() },
}));

vi.mock("electron", () => ({ app: { getVersion: () => "1.6.0-beta.3" } }));
vi.mock("../stores/app-state", () => ({
  getAppStateStore: () => ({ get: () => "telemetry-id" }),
}));
vi.mock("../stores/preferences", () => ({ isDeveloperMode: () => true }));
vi.mock("./electron-logger", () => ({ logger }));
vi.mock("./server-exceptions", () => ({ addServerException }));
vi.mock("./system-properties", () => ({ getSystemProperties: () => ({}) }));
vi.mock("./telemetry", () => ({ telemetry: { captureException } }));

const { captureServerException } = await import("./capture-server-exception");

// Recorded from a task that hit this: OpenRouter reports upstream throttling as
// one chunk in an otherwise successful stream, and the chunk is thrown verbatim
// rather than as an `Error`.
const STREAMED_THROTTLE = {
  code: 429,
  message: "openai/gpt-5.6-luna is temporarily rate-limited upstream.",
  metadata: { error_type: "rate_limit_exceeded" },
};

describe("captureServerException", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "groupCollapsed").mockImplementation(noop);
    vi.spyOn(console, "groupEnd").mockImplementation(noop);
  });

  it("gives the exception list a sentence when the throw is not an Error", () => {
    captureServerException(STREAMED_THROTTLE, {
      scopes: ["workspace"],
    });

    expect(addServerException).toHaveBeenCalledWith({
      code: "429",
      details: `{
  code: 429,
  message: 'openai/gpt-5.6-luna is temporarily rate-limited upstream.',
  metadata: { error_type: 'rate_limit_exceeded' }
}`,
      message: "openai/gpt-5.6-luna is temporarily rate-limited upstream.",
      rpcPath: undefined,
    });
  });

  it("reports the same throw to telemetry without losing the rest of it", () => {
    captureServerException(STREAMED_THROTTLE);

    const [error, telemetryId, properties] =
      captureException.mock.calls[0] ?? [];

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      message: "openai/gpt-5.6-luna is temporarily rate-limited upstream.",
    });
    expect(telemetryId).toBe("telemetry-id");
    expect(properties).toMatchObject({
      error_code: "429",
      error_details: expect.stringContaining("rate_limit_exceeded"),
    });
  });

  it("keeps an Error's own stack and message", () => {
    const error = new Error("plain failure");

    captureServerException(error, { rpc_path: ["task", "create"] });

    expect(captureException).toHaveBeenCalledWith(
      error,
      "telemetry-id",
      expect.objectContaining({ rpc_path: "task.create" }),
    );
    expect(addServerException).toHaveBeenCalledWith({
      code: undefined,
      details: error.stack,
      message: "plain failure",
      rpcPath: "task.create",
    });
    // The stack already carries everything, so it is not repeated as a property.
    expect(captureException.mock.calls[0]?.[2]).not.toHaveProperty(
      "error_details",
    );
  });

  // Recorded from the shape a failed file listing arrives in: the RPC error
  // names the route's error code, the typed error under it says one sentence
  // for every way the walk can fail, and only the throw under *that* says which
  // way it did.
  it("reports what a wrapped throw was, which the message it kept cannot say", () => {
    const walkFailed = Object.assign(
      new Error("EACCES: permission denied, scandir '/Users/someone/locked'"),
      { code: "EACCES" },
    );
    const typedError = Object.assign(new Error("Error listing task files"), {
      cause: walkFailed,
      type: "workspace-filesystem-error",
    });
    const rpcError = Object.assign(new Error("Error listing task files"), {
      cause: typedError,
      code: "FILE_SYSTEM_ERROR",
    });

    captureServerException(rpcError, {
      rpc_path: ["workspace", "task", "files", "list"],
    });

    expect(captureException.mock.calls[0]?.[2]).toMatchObject({
      error_causes: "workspace-filesystem-error <- Error(EACCES)",
    });
  });

  it("keeps a cause that points back at itself from filling the report", () => {
    const looping: Error & { cause?: unknown } = new Error("round and round");
    looping.cause = looping;

    captureServerException(looping);

    expect(captureException.mock.calls[0]?.[2]).toMatchObject({
      error_causes: "Error",
    });
  });

  it("says nothing about causes for a throw that wrapped none", () => {
    captureServerException(new Error("plain failure"));

    expect(captureException.mock.calls[0]?.[2]).not.toHaveProperty(
      "error_causes",
    );
  });
});
