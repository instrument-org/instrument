import { describe, expect, it } from "vitest";

import { compareVersions, feedVersion, newerServed } from "./release-channels";

describe("compareVersions", () => {
  it.each([
    ["2.1.0-beta.4", "2.0.11", 1],
    ["2.0.11", "2.0.11-beta.0", 1],
    ["2.0.10", "2.0.11", -1],
    ["2.0.11-beta.10", "2.0.11-beta.9", 1],
    ["2.1.0-alpha.1", "2.1.0-beta.0", -1],
    ["2.0.11", "2.0.11", 0],
  ])("%s against %s", (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });
});

describe("feedVersion", () => {
  it.each([
    ["version: 2.1.0-beta.4\nfiles:\n  - url: x.exe\n", "2.1.0-beta.4"],
    ['{\n  "version": "2.0.10",\n  "files": []\n}', "2.0.10"],
    [
      '{"Assets":[{"Version":"2.1.0-beta.3"},{"Version":"2.1.0-beta.4"},{"Version":"2.0.9"}]}',
      "2.1.0-beta.4",
    ],
  ])("reads %j", (text, version) => {
    expect(feedVersion(text)).toBe(version);
  });
});

describe("newerServed", () => {
  it("keeps a stable off a channel serving a newer beta", () => {
    expect(newerServed("2.0.11", "version: 2.1.0-beta.4\n")).toBe(
      "2.1.0-beta.4",
    );
  });

  it("releases on a channel serving an older version or none", () => {
    expect(newerServed("2.0.11", "version: 2.0.11-beta.2\n")).toBeUndefined();
    expect(newerServed("2.0.11", undefined)).toBeUndefined();
  });
});
