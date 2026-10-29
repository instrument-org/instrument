import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const fetch = vi.fn<(url: string) => Promise<Response>>();
vi.mock("electron", () => ({ app: {}, net: { fetch } }));

const { newestFullRelease, updaterCacheDirs } = await import("./update-bridge");
const { hasFeedFile } = await import("./update-velopack");

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
