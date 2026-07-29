import { type UpdateInfo } from "electron-updater";
import { describe, expect, it } from "vitest";

import {
  type AppUpdaterStatus,
  createUpdatePhase,
  isNewerVersion,
  isSameStatus,
  nextPollDelayMs,
  POLL_INTERVAL_MS,
  resolveInstallDecision,
  resolveStatus,
  STAGED_POLL_INTERVAL_MS,
  type UpdatePhase,
} from "./update-status";

function phase(overrides: Partial<UpdatePhase> = {}): UpdatePhase {
  return { ...createUpdatePhase(), ...overrides };
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

const STAGED = updateInfo("1.5.0");
const NEWER = updateInfo("1.6.0");

describe("resolveStatus", () => {
  it("passes everything through when nothing is staged", () => {
    const next: AppUpdaterStatus = {
      message: "boom",
      notifyUser: false,
      type: "error",
    };
    expect(resolveStatus({ next, phase: phase() })).toBe(next);
  });

  it.each([
    ["checking", { notifyUser: false, type: "checking" }],
    [
      "not-available",
      { notifyUser: false, type: "not-available", updateInfo: null },
    ],
    ["error", { message: "offline", notifyUser: false, type: "error" }],
    ["canceled", { notifyUser: false, type: "canceled", updateInfo: STAGED }],
  ] satisfies [string, AppUpdaterStatus][])(
    "keeps the staged update visible against a background %s",
    (_label, next) => {
      expect(
        resolveStatus({ next, phase: phase({ staged: STAGED }) }),
      ).toMatchObject({ type: "downloaded", updateInfo: STAGED });
    },
  );

  it("ignores the feed re-offering the version that is already staged", () => {
    const next: AppUpdaterStatus = {
      notifyUser: false,
      type: "available",
      updateInfo: STAGED,
    };
    expect(
      resolveStatus({ next, phase: phase({ staged: STAGED }) }),
    ).toMatchObject({ type: "downloaded", updateInfo: STAGED });
  });

  it("ignores progress from a cached re-download of the staged build", () => {
    const next: AppUpdaterStatus = {
      notifyUser: false,
      progress: {
        bytesPerSecond: 1,
        delta: 1,
        percent: 12,
        total: 100,
        transferred: 12,
      },
      type: "downloading",
    };
    expect(
      resolveStatus({ next, phase: phase({ staged: STAGED }) }),
    ).toMatchObject({ type: "downloaded", updateInfo: STAGED });
  });

  // A superseding download clears `staged`, because electron-updater empties its
  // pending cache the moment a different version starts downloading.
  it("hands the status to a strictly newer build that is downloading", () => {
    const next: AppUpdaterStatus = {
      notifyUser: false,
      type: "available",
      updateInfo: NEWER,
    };
    expect(
      resolveStatus({
        next,
        phase: phase({ pendingNewer: NEWER, staged: null }),
      }),
    ).toBe(next);
  });

  it("does not claim a build is ready once its download failed", () => {
    const next: AppUpdaterStatus = {
      message: "connection reset",
      notifyUser: true,
      type: "error",
    };
    expect(resolveStatus({ next, phase: phase({ staged: null }) })).toBe(next);
  });

  it("shows a user-initiated check but not a background poll", () => {
    const next: AppUpdaterStatus = { notifyUser: true, type: "checking" };
    expect(
      resolveStatus({
        next,
        phase: phase({ staged: STAGED, verifying: true }),
      }),
    ).toBe(next);
    expect(
      resolveStatus({ next, phase: phase({ staged: STAGED }) }),
    ).toMatchObject({ type: "downloaded" });
  });

  it("lets a failed install surface instead of folding back to ready", () => {
    const next: AppUpdaterStatus = {
      message: "installer exited 1",
      notifyUser: true,
      type: "error",
    };
    expect(
      resolveStatus({
        next,
        phase: phase({ installing: true, staged: STAGED }),
      }),
    ).toBe(next);
  });

  it("accepts a newly staged build over the previous one", () => {
    const next: AppUpdaterStatus = {
      notifyUser: true,
      type: "downloaded",
      updateInfo: NEWER,
    };
    expect(
      resolveStatus({
        next,
        phase: phase({ pendingNewer: NEWER, staged: STAGED }),
      }),
    ).toBe(next);
  });
});

describe("resolveInstallDecision", () => {
  it("reports when there is nothing to install", () => {
    expect(
      resolveInstallDecision({
        currentVersion: "1.5.0",
        latestVersion: undefined,
        pendingVersion: undefined,
        stagedVersion: undefined,
      }),
    ).toEqual({ type: "nothing-staged" });
  });

  // Reached after a superseding download wiped the staged artifact: "we're
  // fetching 1.6.0" beats "nothing to install", which is true but useless.
  it("defers to a newer build even with nothing staged", () => {
    expect(
      resolveInstallDecision({
        currentVersion: "1.5.0",
        latestVersion: "1.6.0",
        pendingVersion: undefined,
        stagedVersion: undefined,
      }),
    ).toEqual({ type: "defer", version: "1.6.0" });
  });

  it("installs the staged build when the feed agrees it is the latest", () => {
    expect(
      resolveInstallDecision({
        currentVersion: "1.4.0",
        latestVersion: "1.5.0",
        pendingVersion: undefined,
        stagedVersion: "1.5.0",
      }),
    ).toEqual({ type: "install", version: "1.5.0" });
  });

  it("defers when the feed advertises a newer build than the staged one", () => {
    expect(
      resolveInstallDecision({
        currentVersion: "1.4.0",
        latestVersion: "1.6.0",
        pendingVersion: undefined,
        stagedVersion: "1.5.0",
      }),
    ).toEqual({ type: "defer", version: "1.6.0" });
  });

  it("defers on an in-flight download when the feed is unreachable", () => {
    expect(
      resolveInstallDecision({
        currentVersion: "1.4.0",
        latestVersion: undefined,
        pendingVersion: "1.6.0",
        stagedVersion: "1.5.0",
      }),
    ).toEqual({ type: "defer", version: "1.6.0" });
  });

  it("installs the staged build when the feed is unreachable and nothing newer is in flight", () => {
    expect(
      resolveInstallDecision({
        currentVersion: "1.4.0",
        latestVersion: undefined,
        pendingVersion: undefined,
        stagedVersion: "1.5.0",
      }),
    ).toEqual({ type: "install", version: "1.5.0" });
  });

  it("installs the staged build when the feed has rolled back below it", () => {
    expect(
      resolveInstallDecision({
        currentVersion: "1.4.0",
        latestVersion: "1.4.5",
        pendingVersion: undefined,
        stagedVersion: "1.5.0",
      }),
    ).toEqual({ type: "install", version: "1.5.0" });
  });

  it.each([
    ["equal to", "1.5.0"],
    ["newer than", "1.6.0"],
  ])("refuses a staged build %s the running app", (_label, currentVersion) => {
    expect(
      resolveInstallDecision({
        currentVersion,
        latestVersion: undefined,
        pendingVersion: undefined,
        stagedVersion: "1.5.0",
      }),
    ).toEqual({ type: "stale-staged", version: "1.5.0" });
  });

  it("orders prerelease builds numerically", () => {
    expect(
      resolveInstallDecision({
        currentVersion: "1.4.2-beta.6",
        latestVersion: "1.4.2-beta.10",
        pendingVersion: undefined,
        stagedVersion: "1.4.2-beta.7",
      }),
    ).toEqual({ type: "defer", version: "1.4.2-beta.10" });
  });

  it("ignores an unparsable version from the feed", () => {
    expect(
      resolveInstallDecision({
        currentVersion: "1.4.0",
        latestVersion: "nightly",
        pendingVersion: undefined,
        stagedVersion: "1.5.0",
      }),
    ).toEqual({ type: "install", version: "1.5.0" });
  });
});

describe("isNewerVersion", () => {
  it.each([
    ["anything beats nothing", undefined, "1.5.0", true],
    ["a higher patch wins", "1.5.0", "1.5.1", true],
    ["the same version does not", "1.5.0", "1.5.0", false],
    ["a lower version does not", "1.5.0", "1.4.9", false],
    ["a prerelease loses to its release", "1.5.0", "1.5.0-beta.1", false],
    ["prereleases order numerically", "1.5.0-beta.9", "1.5.0-beta.10", true],
    ["garbage never wins", "1.5.0", "not-a-version", false],
  ])("%s", (_label, baseline, candidate, expected) => {
    expect(isNewerVersion({ baseline, candidate })).toBe(expected);
  });
});

describe("isSameStatus", () => {
  it("deduplicates a re-published staged update", () => {
    const a: AppUpdaterStatus = {
      notifyUser: true,
      type: "downloaded",
      updateInfo: STAGED,
    };
    const b: AppUpdaterStatus = {
      notifyUser: true,
      type: "downloaded",
      updateInfo: updateInfo("1.5.0"),
    };
    expect(isSameStatus(a, b)).toBe(true);
  });

  it("keeps a different version", () => {
    expect(
      isSameStatus(
        { notifyUser: true, type: "downloaded", updateInfo: STAGED },
        { notifyUser: true, type: "downloaded", updateInfo: NEWER },
      ),
    ).toBe(false);
  });

  it("never deduplicates progress", () => {
    const progress = {
      bytesPerSecond: 1,
      delta: 1,
      percent: 10,
      total: 100,
      transferred: 10,
    };
    expect(
      isSameStatus(
        { notifyUser: false, progress, type: "downloading" },
        { notifyUser: false, progress, type: "downloading" },
      ),
    ).toBe(false);
  });

  it("keeps a status whose notification intent changed", () => {
    expect(
      isSameStatus(
        { notifyUser: false, type: "not-available", updateInfo: null },
        { notifyUser: true, type: "not-available", updateInfo: null },
      ),
    ).toBe(false);
  });
});

describe("nextPollDelayMs", () => {
  it("polls harder while an update is waiting to be installed", () => {
    expect(nextPollDelayMs({ hasStagedUpdate: true })).toBe(
      STAGED_POLL_INTERVAL_MS,
    );
    expect(nextPollDelayMs({ hasStagedUpdate: false })).toBe(POLL_INTERVAL_MS);
    expect(STAGED_POLL_INTERVAL_MS).toBeLessThan(POLL_INTERVAL_MS);
  });
});
