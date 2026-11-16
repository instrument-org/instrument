import { describe, expect, it } from "vitest";

import {
  atLeastPinnedMajor,
  officeArtifact,
  officeDownloadUrl,
  officeMajor,
  OFFICE_VERSION,
} from "./manifest";
import { OFFICE_MANIFEST } from "./manifest.generated";

describe("the pinned LibreOffice", () => {
  it("pins every platform and architecture the app ships for", () => {
    expect(Object.keys(OFFICE_MANIFEST.artifacts).sort()).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-x64",
      "win32-arm64",
      "win32-x64",
    ]);
  });

  it.each(Object.entries(OFFICE_MANIFEST.artifacts))(
    "names %s's file, size and SHA-256 for the pinned version",
    (_, artifact) => {
      expect(artifact.file).toContain(`_${OFFICE_VERSION}_`);
      expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(artifact.bytes).toBeGreaterThan(100_000_000);
    },
  );

  it("downloads from TDF's archive, where a build's address never moves", () => {
    const artifact = officeArtifact("darwin", "arm64");
    expect(artifact && officeDownloadUrl(artifact)).toBe(
      `https://downloadarchive.documentfoundation.org/libreoffice/old/${OFFICE_VERSION}/mac/aarch64/LibreOffice_${OFFICE_VERSION}_MacOS_aarch64.dmg`,
    );
  });

  it("has nothing for a platform TDF builds nothing for", () => {
    expect(officeArtifact("freebsd", "x64")).toBeUndefined();
    expect(officeArtifact("linux", "ia32")).toBeUndefined();
  });
});

describe("atLeastPinnedMajor", () => {
  it.each([
    ["26.2.0.1", "26.2.7.3", true],
    ["26.8.1", "26.2.7.3", true],
    ["27.2", "26.8.3.1", true],
    ["26.1.9", "26.2.7.3", false],
    ["25.8.7.2", "26.2.7.3", false],
    ["7.6.4.1", "26.2.7.3", false],
    ["garbage", "26.2.7.3", false],
  ])("%s against %s is %s", (have, pinned, expected) => {
    expect(atLeastPinnedMajor(have, pinned)).toBe(expected);
  });

  it("takes the release line from a version", () => {
    expect(officeMajor("26.2.7.3")).toBe("26.2");
  });
});
