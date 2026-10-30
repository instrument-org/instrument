import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const fetch = vi.fn<(url: string) => Promise<Response>>();
vi.mock("electron", () => ({ app: {}, net: { fetch } }));

const {
  MOVE_FAILURE_BACKOFF_MS,
  newestFullRelease,
  recentMoveFailure,
  updaterCacheDirs,
} = await import("./update-bridge");
const { hasFeedFile, restoreCheckedUpdater } =
  await import("./update-velopack");

const feed = (...assets: { Type: string; Version: string }[]) => ({
  Assets: assets.map((asset) => ({ FileName: "x.nupkg", ...asset })),
});

describe("newestFullRelease", () => {
  it("offers the newest full release, deltas aside", () => {
    expect(
      newestFullRelease(
        feed(
          { Type: "Full", Version: "2.0.1" },
          { Type: "Full", Version: "2.0.3" },
          { Type: "Delta", Version: "2.0.4" },
        ),
        "2.0.1",
      ),
    ).toBe("2.0.3");
  });

  it("offers the running version itself, which the move reinstalls", () => {
    expect(
      newestFullRelease(
        feed({ Type: "Full", Version: "2.0.0-beta.111" }),
        "2.0.0-beta.111",
      ),
    ).toBe("2.0.0-beta.111");
  });

  it("never offers an older version", () => {
    expect(
      newestFullRelease(
        feed({ Type: "Full", Version: "2.0.0-beta.110" }),
        "2.0.0-beta.111",
      ),
    ).toBeUndefined();
  });

  it.each([
    ["no assets", {}],
    ["not an object", "nope"],
    ["an invalid version", feed({ Type: "Full", Version: "latest" })],
  ])("offers nothing for %s", (_name, value) => {
    expect(newestFullRelease(value, "1.0.0")).toBeUndefined();
  });
});

describe("updaterCacheDirs", () => {
  it("takes the folder the install's app-update.yml names, and this build's", () => {
    expect(
      updaterCacheDirs(
        "bucket: instrument-releases\nprovider: s3\nupdaterCacheDirName: instrument-updater\nchannel: beta\n",
      ),
    ).toEqual(["instrument-updater", "instrument-desktop-updater"]);
  });

  it("takes this build's alone without a readable file", () => {
    expect(updaterCacheDirs(undefined)).toEqual(["instrument-desktop-updater"]);
  });

  it.each([
    ["a path", "updaterCacheDirName: ..\\Programs\n"],
    ["a parent", "updaterCacheDirName: ..\n"],
    ["nothing", "updaterCacheDirName:\n"],
  ])("never names a folder outside its own from %s", (_name, yml) => {
    expect(updaterCacheDirs(yml)).toEqual(["instrument-desktop-updater"]);
  });

  it("reads a quoted name once", () => {
    expect(
      updaterCacheDirs("updaterCacheDirName: 'instrument-desktop-updater'\r\n"),
    ).toEqual(["instrument-desktop-updater"]);
  });
});

describe("hasFeedFile", () => {
  // No release on the channel yet: no update, not a failed check.
  it.each([
    [200, true],
    [404, false],
  ])("reads a %i from the bucket as %s", async (status, expected) => {
    fetch.mockResolvedValueOnce(new Response(null, { status }));
    await expect(
      hasFeedFile("https://example.test/velopack", "releases.latest.json"),
    ).resolves.toBe(expected);
  });

  it("fails the check on any other answer", async () => {
    fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(
      hasFeedFile("https://example.test/velopack", "releases.latest.json"),
    ).rejects.toThrow("503");
  });

  it("looks in a test host's folder", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "feed-"));
    fs.writeFileSync(path.join(folder, "releases.beta.json"), "{}");
    await expect(hasFeedFile(folder, "releases.beta.json")).resolves.toBe(true);
    await expect(hasFeedFile(folder, "releases.latest.json")).resolves.toBe(
      false,
    );
    fs.rmSync(folder, { recursive: true });
  });
});

describe("recentMoveFailure", () => {
  const day = 24 * 60 * 60 * 1000;
  const failedAt = Date.UTC(2026, 9, 1);
  const withMarker = () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "move-"));
    const marker = path.join(folder, "windows-velopack-move.failed");
    fs.writeFileSync(marker, "failed");
    fs.utimesSync(marker, failedAt / 1000, failedAt / 1000);
    return { folder, marker };
  };

  it("offers the move when nothing failed", () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "move-"));
    expect(recentMoveFailure(folder)).toBeUndefined();
    fs.rmSync(folder, { recursive: true });
  });

  it.each([
    ["an hour after", failedAt + day / 24],
    ["a clock set back a day", failedAt - day],
  ])("backs off %s a failure", (_name, now) => {
    const { folder, marker } = withMarker();
    expect(recentMoveFailure(folder, now)?.getTime()).toBe(failedAt);
    expect(fs.existsSync(marker)).toBe(true);
    fs.rmSync(folder, { recursive: true });
  });

  it("offers it again once the backoff is over, and clears the marker", () => {
    const { folder, marker } = withMarker();
    expect(
      recentMoveFailure(folder, failedAt + MOVE_FAILURE_BACKOFF_MS),
    ).toBeUndefined();
    expect(fs.existsSync(marker)).toBe(false);
    fs.rmSync(folder, { recursive: true });
  });
});

describe("restoreCheckedUpdater", () => {
  const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const setup = (files: Record<string, string>) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "velopack-"));
    fs.mkdirSync(path.join(root, "packages"));
    for (const [name, text] of Object.entries(files)) {
      fs.writeFileSync(path.join(root, name), text);
    }
    return {
      keptUpdater: path.join(root, "packages", "Update.exe.checked"),
      read: () => fs.readFileSync(path.join(root, "Update.exe"), "utf8"),
      root,
      updateExe: path.join(root, "Update.exe"),
    };
  };

  it("puts the checked copy back over an unchecked one", () => {
    const at = setup({
      "packages/Update.exe.checked": "checked",
      "Update.exe": "unchecked",
    });
    restoreCheckedUpdater({ ...at, log });
    expect(at.read()).toBe("checked");
    fs.rmSync(at.root, { recursive: true });
  });

  it("writes nothing when they match or nothing was kept", () => {
    log.warn.mockClear();
    const at = setup({ "Update.exe": "same" });
    restoreCheckedUpdater({ ...at, log });
    expect(at.read()).toBe("same");
    fs.writeFileSync(at.keptUpdater, "same");
    fs.utimesSync(at.updateExe, 1, 1);
    restoreCheckedUpdater({ ...at, log });
    expect(fs.statSync(at.updateExe).mtimeMs).toBe(1000);
    expect(log.warn).not.toHaveBeenCalled();
    fs.rmSync(at.root, { recursive: true });
  });
});
