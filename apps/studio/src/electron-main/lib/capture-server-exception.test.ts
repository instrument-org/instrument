import { beforeEach, describe, expect, it, vi } from "vitest";

const { addServerException, logger } = vi.hoisted(() => ({
  addServerException: vi.fn(),
  logger: { error: vi.fn() },
}));

vi.mock("@/electron-main/stores/workspace/preferences", () => ({
  isDeveloperMode: () => true,
}));
vi.mock("./electron-logger", () => ({ logger }));
vi.mock("./server-exceptions", () => ({ addServerException }));

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

  it("keeps an Error's own stack and message", () => {
    const error = new Error("plain failure");

    captureServerException(error, { rpc_path: ["task", "create"] });

    expect(addServerException).toHaveBeenCalledWith({
      code: undefined,
      details: error.stack,
      message: "plain failure",
      rpcPath: "task.create",
    });
    expect(logger.error).toHaveBeenCalledWith(
      "[Exception] [task.create] plain failure",
      error.stack,
    );
  });
});
