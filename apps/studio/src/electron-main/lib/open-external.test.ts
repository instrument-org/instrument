import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.fn();

vi.mock("./capture-server-exception", () => ({
  captureServerException: (error: unknown) => {
    captured(error);
  },
}));
vi.mock("./electron-logger", () => ({
  logger: { scope: () => ({ warn: vi.fn() }) },
}));
vi.mock("electron", () => ({
  shell: { openExternal: vi.fn() },
}));
// Pinned off Linux so the xdg-open branch, which shells out, never runs here.
vi.mock("node:os", () => ({
  default: { platform: () => "darwin" },
}));

const { openExternal } = await import("./open-external");

describe("openExternal", () => {
  beforeEach(() => {
    captured.mockClear();
  });

  it("opens an allowed URL without capturing anything", async () => {
    await expect(openExternal("https://example.test/page")).resolves.toBe(true);
    expect(captured).not.toHaveBeenCalled();
  });

  // The URL originates in model output and can name a local file path, so the
  // captured message says what was blocked and never what the URL was.
  it("keeps a blocked URL out of the captured exception", async () => {
    const opened = await openExternal("file:///Users/someone/.ssh/id_rsa");

    expect(opened).toBe(false);
    const error = captured.mock.calls[0]?.[0] as Error;
    expect(error.message).toBe(
      "Blocked attempt to open URL with unsafe protocol: file:",
    );
  });

  it("keeps an unparsable URL out of the captured exception", async () => {
    const opened = await openExternal("http://[/Users/someone/secret");

    expect(opened).toBe(false);
    const error = captured.mock.calls[0]?.[0] as Error;
    expect(error.message).toBe("Invalid URL format in openExternal");
  });
});
