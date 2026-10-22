import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { electronApp, logger } = vi.hoisted(() => ({
  electronApp: { isPackaged: false },
  logger: { info: vi.fn(), warn: vi.fn() },
}));

vi.mock("electron", () => ({ app: electronApp }));
vi.mock("@/electron-main/lib/electron-logger", () => ({ logger }));

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

  it("goes down on a refused connection and reports when the server answers", async () => {
    const fetch = vi.fn().mockRejectedValue(refused());
    vi.stubGlobal("fetch", fetch);
    const onChange = vi.fn();
    const reachability = await load();

    reachability.startPlatformApiReachability({ onChange });
    await vi.advanceTimersByTimeAsync(0);

    expect(reachability.isPlatformApiUnreachable()).toBe(true);
    expect(logger.warn).toHaveBeenCalledOnce();

    // Still down at the next probe: no second warning or change.
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledOnce();

    fetch.mockResolvedValue(new Response(null, { status: 404 }));
    await vi.advanceTimersByTimeAsync(5000);

    expect(reachability.getPlatformApiReachability()).toBe("reachable");
    expect(onChange.mock.calls).toEqual([["unreachable"], ["reachable"]]);

    // Up: the probe stops.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("leaves a failure that is not about the connection alone", async () => {
    const reachability = await load();

    reachability.notePlatformApiFailed(new Error("bad payload"));

    expect(reachability.getPlatformApiReachability()).toBe("unknown");
  });

  it("comes back up when the global Response is not the class fetch answers with", async () => {
    electronApp.isPackaged = true;
    // What @hono/node-server leaves on the global in the main process.
    vi.stubGlobal("Response", class LightweightResponse {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    );
    const reachability = await load();
    reachability.startPlatformApiReachability({ onChange: vi.fn() });

    reachability.notePlatformApiFailed(refused());
    expect(reachability.isPlatformApiUnreachable()).toBe(true);

    await vi.advanceTimersByTimeAsync(5000);
    expect(reachability.getPlatformApiReachability()).toBe("reachable");
  });

  it("asks from a packaged build only after a request failed, backing off", async () => {
    electronApp.isPackaged = true;
    const fetch = vi.fn().mockRejectedValue(refused());
    vi.stubGlobal("fetch", fetch);
    const reachability = await load();

    reachability.startPlatformApiReachability({ onChange: vi.fn() });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).not.toHaveBeenCalled();

    reachability.notePlatformApiFailed(refused());
    expect(reachability.isPlatformApiUnreachable()).toBe(true);

    const askedAt: number[] = [];
    fetch.mockImplementation(() => {
      askedAt.push(Date.now());
      return Promise.reject(refused());
    });
    const start = Date.now();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(askedAt.map((at) => (at - start) / 1000)).toMatchInlineSnapshot(`
      [
        5,
        10,
        20,
        40,
        80,
        140,
        200,
        260,
      ]
    `);
  });

  it("asks again at once when told to, starting the backoff over", async () => {
    electronApp.isPackaged = true;
    const fetch = vi.fn().mockRejectedValue(refused());
    vi.stubGlobal("fetch", fetch);
    const reachability = await load();
    reachability.startPlatformApiReachability({ onChange: vi.fn() });
    reachability.notePlatformApiFailed(refused());
    await vi.advanceTimersByTimeAsync(100_000);
    fetch.mockClear();

    fetch.mockResolvedValue(new Response(null, { status: 200 }));
    reachability.probePlatformApiNow();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetch).toHaveBeenCalledOnce();
    expect(reachability.getPlatformApiReachability()).toBe("reachable");
  });
});

describe("probeDelay", () => {
  it("doubles in a packaged build up to a minute and stays at 5s in development", async () => {
    const { probeDelay } = await load();
    const failures = [0, 1, 2, 3, 4, 5, 6, 10];
    expect(failures.map((n) => probeDelay(n, true) / 1000))
      .toMatchInlineSnapshot(`
      [
        5,
        5,
        10,
        20,
        40,
        60,
        60,
        60,
      ]
    `);
    expect(failures.map((n) => probeDelay(n, false) / 1000))
      .toMatchInlineSnapshot(`
      [
        5,
        5,
        5,
        5,
        5,
        5,
        5,
        5,
      ]
    `);
  });
});
