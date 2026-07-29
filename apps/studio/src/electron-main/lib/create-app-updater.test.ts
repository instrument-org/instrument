import {
  type ProgressInfo,
  type UpdateCheckResult,
  type UpdateInfo,
} from "electron-updater";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAppUpdater,
  type UpdaterEvents,
  type UpdaterPort,
} from "./create-app-updater";
import {
  type AppUpdaterStatus,
  POLL_INTERVAL_MS,
  STAGED_POLL_INTERVAL_MS,
  VERIFY_TIMEOUT_MS,
} from "./update-status";

const CURRENT = "1.4.0";
const STAGED = "1.5.0";
const NEWER = "1.6.0";

// A stand-in for electron-updater: the check resolves to whatever the test
// queued, and the events it would emit are fired by hand so ordering is explicit.
function createHarness({
  confirmQuit,
  currentVersion = CURRENT,
}: {
  confirmQuit?: () => Promise<boolean>;
  currentVersion?: string;
} = {}) {
  let handlers: undefined | UpdaterEvents;
  let nextCheck: () => Promise<null | UpdateCheckResult> = () =>
    Promise.resolve(null);

  const installs = vi.fn();
  const published: AppUpdaterStatus[] = [];
  const checks = vi.fn();
  const recordCheck = vi.fn();

  const port: UpdaterPort = {
    checkForUpdates: () => {
      checks();
      return nextCheck();
    },
    configureFeed: vi.fn(),
    install: installs,
    isActive: () => true,
    subscribe: (next) => {
      handlers = next;
    },
  };

  const updater = createAppUpdater({
    confirmQuit,
    getCurrentVersion: () => currentVersion,
    installNotice: undefined,
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    publish: (status) => published.push(status),
    recordCheck,
    updater: port,
  });

  function events() {
    if (!handlers) {
      throw new Error("createAppUpdater did not subscribe");
    }
    return handlers;
  }

  return {
    checks,
    // Drives the updater into "an update is downloaded and ready to install".
    events,
    installs,
    published,
    recordCheck,
    stage(version: string) {
      events().available(updateInfo(version));
      events().downloaded(updateInfo(version));
      published.length = 0;
    },
    // The feed answers with `version`, and reports a download when it is newer
    // than what the app already knows about.
    respondWith(version: string | undefined, downloadPromise?: Promise<never>) {
      nextCheck = () =>
        Promise.resolve(
          version === undefined
            ? null
            : ({
                downloadPromise,
                isUpdateAvailable: true,
                updateInfo: updateInfo(version),
                versionInfo: updateInfo(version),
              } satisfies Partial<UpdateCheckResult> as UpdateCheckResult),
        );
    },
    respondWithFailure(error: Error) {
      nextCheck = () => Promise.reject(error);
    },
    // A feed that accepts the connection and then stalls well past the
    // pre-install timeout.
    respondWithStall() {
      nextCheck = () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(null);
          }, VERIFY_TIMEOUT_MS * 10);
        });
    },
    updater,
  };
}

function progressInfo(percent: number): ProgressInfo {
  return {
    bytesPerSecond: 1,
    delta: 1,
    percent,
    total: 100,
    transferred: percent,
  };
}

function updateInfo(version: string): UpdateInfo {
  return {
    files: [],
    path: "",
    releaseDate: "2026-07-29T00:00:00.000Z",
    sha512: "",
    version,
  };
}

describe("quitAndInstall", () => {
  it("installs the staged build when the feed confirms it is the latest", async () => {
    const h = createHarness();
    h.stage(STAGED);
    h.respondWith(STAGED);

    await expect(h.updater.quitAndInstall()).resolves.toEqual({
      type: "installing",
    });
    expect(h.installs).toHaveBeenCalledOnce();
    expect(h.published.at(-1)).toMatchObject({ type: "installing" });
  });

  it("defers to a newer build the pre-install check discovers", async () => {
    const h = createHarness();
    h.stage(STAGED);
    // The check that finds the newer build emits `available` for it, the way
    // electron-updater does before auto-download starts.
    h.respondWith(NEWER);

    const install = h.updater.quitAndInstall();
    h.events().available(updateInfo(NEWER));

    await expect(install).resolves.toEqual({
      type: "deferred",
      version: NEWER,
    });
    expect(h.installs).not.toHaveBeenCalled();
  });

  it("treats the staged build as gone once a newer one starts downloading", () => {
    const h = createHarness();
    h.stage(STAGED);

    h.events().available(updateInfo(NEWER));

    // electron-updater empties its pending cache here, so the UI must stop
    // offering the old build rather than showing it as ready.
    expect(h.published.at(-1)).toMatchObject({ type: "available" });
    h.events().progress(progressInfo(40));
    expect(h.published.at(-1)).toMatchObject({ type: "downloading" });
  });

  it("never installs the old build after the superseding download fails", async () => {
    const h = createHarness();
    h.stage(STAGED);
    h.events().available(updateInfo(NEWER));
    h.events().failed(new Error("connection reset"));

    // The old artifact was wiped when the newer download started and the newer
    // one never arrived: an error, not a ready-to-install badge.
    expect(h.published.at(-1)).toMatchObject({ type: "error" });

    // Retrying keeps chasing the newer build rather than running an installer
    // that is no longer on disk.
    h.respondWith(NEWER);
    await expect(h.updater.quitAndInstall()).resolves.toEqual({
      type: "deferred",
      version: NEWER,
    });
    expect(h.installs).not.toHaveBeenCalled();
  });

  it("installs the staged build when the feed cannot be reached", async () => {
    const h = createHarness();
    h.stage(STAGED);
    h.respondWithFailure(new Error("offline"));

    await expect(h.updater.quitAndInstall()).resolves.toEqual({
      type: "installing",
    });
    expect(h.installs).toHaveBeenCalledOnce();
  });

  it("still defers offline when a newer download is already in flight", async () => {
    const h = createHarness();
    h.stage(STAGED);
    h.events().downloaded(updateInfo(STAGED));
    h.events().available(updateInfo(NEWER));
    h.respondWithFailure(new Error("offline"));

    await expect(h.updater.quitAndInstall()).resolves.toEqual({
      type: "deferred",
      version: NEWER,
    });
    expect(h.installs).not.toHaveBeenCalled();
  });

  it("refuses to install a build the running app is already past", async () => {
    const h = createHarness({ currentVersion: NEWER });
    h.stage(STAGED);
    h.respondWith(STAGED);

    await expect(h.updater.quitAndInstall()).resolves.toEqual({
      type: "no-update",
    });
    expect(h.installs).not.toHaveBeenCalled();
    expect(h.published.at(-1)).toMatchObject({ type: "not-available" });
  });

  it("reports nothing to install without calling it a failure", async () => {
    const h = createHarness();
    h.respondWith(undefined);

    await expect(h.updater.quitAndInstall()).resolves.toEqual({
      type: "no-update",
    });
    expect(h.installs).not.toHaveBeenCalled();
    expect(h.published.at(-1)).toMatchObject({ type: "not-available" });
  });

  it("aborts without installing when the quit prompt is declined", async () => {
    const confirmQuit = vi.fn().mockResolvedValue(false);
    const h = createHarness({ confirmQuit });
    h.stage(STAGED);
    h.respondWith(STAGED);

    await expect(h.updater.quitAndInstall()).resolves.toEqual({
      type: "quit-canceled",
    });
    expect(h.installs).not.toHaveBeenCalled();
  });

  it("never prompts to quit for an install it then declines to run", async () => {
    const confirmQuit = vi.fn().mockResolvedValue(true);
    const h = createHarness({ confirmQuit });
    h.stage(STAGED);
    h.respondWith(NEWER);

    await h.updater.quitAndInstall();

    expect(confirmQuit).not.toHaveBeenCalled();
  });

  it("shares one run between concurrent requests", async () => {
    const confirmQuit = vi.fn().mockResolvedValue(true);
    const h = createHarness({ confirmQuit });
    h.stage(STAGED);
    h.respondWith(STAGED);

    const [first, second] = await Promise.all([
      h.updater.quitAndInstall(),
      h.updater.quitAndInstall(),
    ]);

    expect([first, second]).toEqual([
      { type: "installing" },
      { type: "installing" },
    ]);
    expect(h.checks).toHaveBeenCalledOnce();
    expect(confirmQuit).toHaveBeenCalledOnce();
    expect(h.installs).toHaveBeenCalledOnce();
  });

  it("keeps the latch after a successful install so a late click is a no-op", async () => {
    const h = createHarness();
    h.stage(STAGED);
    h.respondWith(STAGED);

    await h.updater.quitAndInstall();
    await h.updater.quitAndInstall();

    expect(h.installs).toHaveBeenCalledOnce();
  });

  it.each([
    ["a declined quit prompt", () => Promise.resolve(false)],
    ["a deferral", undefined],
  ])("releases the latch after %s", async (_label, confirmQuit) => {
    const h = createHarness(confirmQuit ? { confirmQuit } : {});
    h.stage(STAGED);
    h.respondWith(confirmQuit ? STAGED : NEWER);

    await h.updater.quitAndInstall();
    await h.updater.quitAndInstall();

    expect(h.checks).toHaveBeenCalledTimes(2);
  });

  // electron-updater's BaseUpdater.install() catches a missing installer or a
  // failed launch, emits `error`, and returns false instead of throwing.
  it("re-arms the retry when the install reports an error without throwing", async () => {
    const h = createHarness();
    h.stage(STAGED);
    h.respondWith(STAGED);
    h.installs.mockImplementationOnce(() => {
      h.events().failed(new Error("No update filepath provided"));
    });

    await expect(h.updater.quitAndInstall()).resolves.toEqual({
      message: "No update filepath provided",
      type: "failed",
    });
    expect(h.published.at(-1)).toMatchObject({ type: "error" });

    await h.updater.quitAndInstall();
    expect(h.installs).toHaveBeenCalledTimes(2);
  });

  it("surfaces an install failure and re-arms the retry", async () => {
    const h = createHarness();
    h.stage(STAGED);
    h.respondWith(STAGED);
    h.installs.mockImplementationOnce(() => {
      throw new Error("installer missing");
    });

    await expect(h.updater.quitAndInstall()).resolves.toEqual({
      message: "installer missing",
      type: "failed",
    });
    expect(h.published.at(-1)).toMatchObject({
      message: "installer missing",
      type: "error",
    });

    await h.updater.quitAndInstall();
    expect(h.installs).toHaveBeenCalledTimes(2);
  });
});

describe("pre-install check", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("installs the staged build rather than hanging on a stalled feed", async () => {
    const h = createHarness();
    h.stage(STAGED);
    h.respondWithStall();

    const install = h.updater.quitAndInstall();
    await vi.advanceTimersByTimeAsync(VERIFY_TIMEOUT_MS + 1);

    await expect(install).resolves.toEqual({ type: "installing" });
    expect(h.installs).toHaveBeenCalledOnce();
  });

  // Timing the check out does not cancel it, so the release it was fetching can
  // still land, and with it the pending-cache wipe that deletes the artifact this
  // install was about to run.
  it("abandons the install when a newer release lands while the quit prompt is open", async () => {
    let releaseConfirm: ((quit: boolean) => void) | undefined;
    const confirmQuit = () =>
      new Promise<boolean>((resolve) => {
        releaseConfirm = resolve;
      });
    const h = createHarness({ confirmQuit });
    h.stage(STAGED);
    h.respondWithStall();

    const install = h.updater.quitAndInstall();
    await vi.advanceTimersByTimeAsync(VERIFY_TIMEOUT_MS + 1);
    expect(releaseConfirm).toBeDefined();

    h.events().available(updateInfo(NEWER));
    releaseConfirm?.(true);

    await expect(install).resolves.toEqual({
      type: "deferred",
      version: NEWER,
    });
    expect(h.installs).not.toHaveBeenCalled();
  });
});

describe("status stream", () => {
  it("keeps a ready update visible against background poll churn", async () => {
    const h = createHarness();
    h.stage(STAGED);

    await h.updater.checkForUpdates();
    h.events().available(updateInfo(STAGED));
    h.events().notAvailable(updateInfo(STAGED));
    h.events().failed(new Error("transient"));

    expect(h.published.every((status) => status.type === "downloaded")).toBe(
      true,
    );
  });

  it("publishes each status once", () => {
    const h = createHarness();
    h.stage(STAGED);

    h.events().downloaded(updateInfo(STAGED));
    h.events().downloaded(updateInfo(STAGED));

    expect(h.published).toHaveLength(0);
  });

  it("owns the download promise so a failed download cannot go unhandled", async () => {
    const h = createHarness();
    const downloadPromise = Promise.reject(new Error("download failed"));
    h.respondWith(NEWER, downloadPromise);

    await h.updater.checkForUpdates();
    await expect(downloadPromise).rejects.toThrow("download failed");
  });
});

describe("pollForUpdates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls harder while an update waits to be installed", async () => {
    const h = createHarness();
    h.respondWith(undefined);

    h.updater.pollForUpdates();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.checks).toHaveBeenCalledTimes(1);
    expect(h.recordCheck).toHaveBeenCalledTimes(1);

    // Nothing staged yet, so the next check is a full interval away.
    await vi.advanceTimersByTimeAsync(STAGED_POLL_INTERVAL_MS);
    expect(h.checks).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(h.checks).toHaveBeenCalledTimes(2);

    h.stage(STAGED);
    await vi.advanceTimersByTimeAsync(STAGED_POLL_INTERVAL_MS);
    expect(h.checks).toHaveBeenCalledTimes(3);
  });

  it("stops checking once an install is under way", async () => {
    const h = createHarness();
    h.stage(STAGED);
    h.respondWith(STAGED);

    h.updater.pollForUpdates();
    await vi.advanceTimersByTimeAsync(0);
    const before = h.checks.mock.calls.length;

    await h.updater.quitAndInstall();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);

    // Only the pre-install check, never another poll.
    expect(h.checks).toHaveBeenCalledTimes(before + 1);
  });
});
