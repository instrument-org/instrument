import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { mergeMacFeedFiles } from "./merge-mac-feeds";

const feed = (version: string, zip: string, dmg: string) => `version: ${version}
files:
  - url: ${zip}
    sha512: ${zip}-sha
    size: 2
  - url: ${dmg}
    sha512: ${dmg}-sha
    size: 3
  - url: ${dmg}
    sha512: ${dmg}-sha
    size: 3
path: ${zip}
sha512: ${zip}-sha
releaseDate: '2026-10-30T17:22:25.326Z'
`;

const arm64 = (version: string) =>
  feed(
    version,
    `Instrument-${version}-arm64-mac.zip`,
    `Instrument-mac-${version}-arm64.dmg`,
  );
const x64 = (version: string) =>
  feed(
    version,
    `Instrument-${version}-mac.zip`,
    `Instrument-mac-${version}-x64.dmg`,
  );

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test fixtures in the manifest shape
const parseFeed = (text: string) => parse(text) as never;
const merge = (texts: Record<string, string>) =>
  mergeMacFeedFiles(texts, parseFeed);

describe("mergeMacFeedFiles", () => {
  it("lists both legs' files under each channel, arm64 first", () => {
    const out = merge({
      "alpha-mac.arm64.yml": arm64("2.0.0-beta.120"),
      "alpha-mac.x64.yml": x64("2.0.0-beta.120"),
      "beta-mac.arm64.yml": arm64("2.0.0-beta.120"),
      "beta-mac.x64.yml": x64("2.0.0-beta.120"),
      "latest-linux.yml": "version: 2.0.0-beta.120\n",
    });
    expect(Object.keys(out)).toEqual(["alpha-mac.yml", "beta-mac.yml"]);
    expect(out["alpha-mac.yml"]).toBe(out["beta-mac.yml"]);
    // Read back as YAML, as electron-updater does, with every type kept.
    expect(parse(out["beta-mac.yml"] ?? "")).toMatchInlineSnapshot(`
      {
        "files": [
          {
            "sha512": "Instrument-2.0.0-beta.120-arm64-mac.zip-sha",
            "size": 2,
            "url": "Instrument-2.0.0-beta.120-arm64-mac.zip",
          },
          {
            "sha512": "Instrument-mac-2.0.0-beta.120-arm64.dmg-sha",
            "size": 3,
            "url": "Instrument-mac-2.0.0-beta.120-arm64.dmg",
          },
          {
            "sha512": "Instrument-2.0.0-beta.120-mac.zip-sha",
            "size": 2,
            "url": "Instrument-2.0.0-beta.120-mac.zip",
          },
          {
            "sha512": "Instrument-mac-2.0.0-beta.120-x64.dmg-sha",
            "size": 3,
            "url": "Instrument-mac-2.0.0-beta.120-x64.dmg",
          },
        ],
        "path": "Instrument-2.0.0-beta.120-arm64-mac.zip",
        "releaseDate": "2026-10-30T17:22:25.326Z",
        "sha512": "Instrument-2.0.0-beta.120-arm64-mac.zip-sha",
        "version": "2.0.0-beta.120",
      }
    `);
  });

  it("keeps the x64 leg's own latest feed for pinned Intel installs", () => {
    const out = merge({
      "latest-mac.arm64.yml": arm64("2.0.0"),
      "latest-mac.x64.yml": x64("2.0.0"),
    });
    expect(Object.keys(out)).toEqual(["latest-mac.yml", "latest-x64-mac.yml"]);
    expect(out["latest-x64-mac.yml"]).toBe(x64("2.0.0"));
  });

  it.each([
    [
      "the x64 leg is missing",
      { "beta-mac.arm64.yml": arm64("2.0.0-beta.120") },
      "beta: the x64 leg wrote no manifest",
    ],
    [
      "the arm64 leg is missing",
      { "latest-mac.x64.yml": x64("2.0.0") },
      "latest: the arm64 leg wrote no manifest",
    ],
    ["no leg wrote any", {}, "No Mac update manifests found"],
    [
      "the versions differ",
      {
        "beta-mac.arm64.yml": arm64("2.0.0-beta.120"),
        "beta-mac.x64.yml": x64("2.0.0-beta.119"),
      },
      "beta: the arm64 leg built 2.0.0-beta.120 and the x64 leg 2.0.0-beta.119",
    ],
    [
      "the x64 leg's files read as arm64",
      {
        "beta-mac.arm64.yml": arm64("2.0.0-beta.120"),
        "beta-mac.x64.yml": arm64("2.0.0-beta.120"),
      },
      "beta: x64 leg file Instrument-2.0.0-beta.120-arm64-mac.zip reads as arm64",
    ],
    [
      "the arm64 leg's files do not read as arm64",
      {
        "beta-mac.arm64.yml": x64("2.0.0-beta.120"),
        "beta-mac.x64.yml": x64("2.0.0-beta.120"),
      },
      'beta: no arm64 leg file has "arm64" in its URL',
    ],
  ])("fails when %s", (_, texts, message) => {
    expect(() => merge(texts)).toThrow(message);
  });
});
