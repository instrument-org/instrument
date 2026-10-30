import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { removeInstalledDownload, updaterCacheRoot } from "./updater-cache";

let cacheDir: string;

function pendingDownload(info: unknown) {
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "updater-cache-"));
  const pending = path.join(cacheDir, "pending");
  fs.mkdirSync(pending);
  fs.writeFileSync(
    path.join(pending, "update-info.json"),
    JSON.stringify(info),
  );
  fs.writeFileSync(path.join(pending, "download.zip"), "zip");
  fs.writeFileSync(path.join(cacheDir, "update.zip"), "zip");
  return pending;
}

afterEach(() => {
  fs.rmSync(cacheDir, { force: true, recursive: true });
});

describe("removeInstalledDownload", () => {
  it.each([
    ["the running version", "2.0.0-beta.116", true],
    ["an older version", "2.0.0-beta.115", true],
    ["a newer version", "2.0.0-beta.117", false],
  ])("handles a download of %s", (_, version, removed) => {
    const pending = pendingDownload({
      fileName: `Instrument-${version}-arm64-mac.zip`,
    });
    expect(
      removeInstalledDownload({ cacheDir, running: "2.0.0-beta.116" }),
    ).toBe(removed);
    expect(fs.existsSync(pending)).toBe(!removed);
    expect(fs.existsSync(path.join(cacheDir, "update.zip"))).toBe(true);
  });

  it.each([
    ["no version in its name", { fileName: "Instrument-arm64-mac.zip" }],
    ["no name", {}],
  ])("leaves a download with %s", (_, info) => {
    const pending = pendingDownload(info);
    expect(
      removeInstalledDownload({ cacheDir, running: "2.0.0-beta.116" }),
    ).toBe(false);
    expect(fs.existsSync(pending)).toBe(true);
  });

  it("does nothing when there is no download", () => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "updater-cache-"));
    expect(
      removeInstalledDownload({ cacheDir, running: "2.0.0-beta.116" }),
    ).toBe(false);
  });
});

describe("updaterCacheRoot", () => {
  it.each([
    ["darwin", {}, "/home/u/Library/Caches"],
    ["linux", {}, "/home/u/.cache"],
    ["linux", { XDG_CACHE_HOME: "/xdg" }, "/xdg"],
    ["win32", {}, undefined],
  ] as const)("on %s with %o", (platform, env, expected) => {
    expect(updaterCacheRoot({ env, home: "/home/u", platform })).toBe(expected);
  });
});
