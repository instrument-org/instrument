import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { electronApp, logger, publish } = vi.hoisted(() => ({
  electronApp: { isPackaged: false },
  logger: { info: vi.fn(), warn: vi.fn() },
  publish: vi.fn(),
}));

vi.mock("electron", () => ({ app: electronApp }));
vi.mock("@/electron-main/lib/electron-logger", () => ({ logger }));
vi.mock("@/electron-main/rpc/publisher", () => ({ publisher: { publish } }));

function refused() {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    }),
  });
}

async function load() {
  vi.resetModules();
  return import("./reachability");
}

describe("platform API reachability", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    electronApp.isPackaged = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("goes down on a refused connection and refetches once the server answers", async () => {
    const fetch = vi.fn().mockRejectedValue(refused());
    vi.stubGlobal("fetch", fetch);
    const onReachableAgain = vi.fn();
    const reachability = await load();

    reachability.startPlatformApiReachability({ onReachableAgain });
    await vi.advanceTimersByTimeAsync(0);

    expect(reachability.isPlatformApiUnreachable()).toBe(true);
    expect(logger.warn).toHaveBeenCalledOnce();

    // Still down at the next probe: no second warning.
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledOnce();

    fetch.mockResolvedValue(new Response(null, { status: 404 }));
    await vi.advanceTimersByTimeAsync(5000);

    expect(reachability.getPlatformApiReachability().status).toBe("reachable");
    expect(onReachableAgain).toHaveBeenCalledOnce();

    // Up: the probe stops.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("leaves a failure that is not about the connection alone", async () => {
    const reachability = await load();

    reachability.notePlatformApiOutcome(new Error("bad payload"));

    expect(reachability.getPlatformApiReachability().status).toBe("unknown");
  });

  it("never asks from a packaged build", async () => {
    electronApp.isPackaged = true;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const reachability = await load();

    reachability.startPlatformApiReachability({ onReachableAgain: vi.fn() });
    reachability.notePlatformApiOutcome(refused());

    expect(fetch).not.toHaveBeenCalled();
    expect(reachability.isPlatformApiUnreachable()).toBe(false);
  });
});
