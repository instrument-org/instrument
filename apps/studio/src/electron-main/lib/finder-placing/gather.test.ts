import { describe, expect, it, vi } from "vitest";

import { type NameProbe, probeNames } from "./gather";

vi.mock("../mac-native", () => ({
  caseSensitivity: () => Promise.resolve(undefined),
  finderEntries: () => Promise.resolve([]),
}));

/**
 * Disks by path: what each path is, on which disk. A path missing is not
 * there; a disk that ignores case answers for a flipped name too.
 */
function disks(
  things: Record<string, { dev: number; ino: number }>,
): Partial<NameProbe> {
  return {
    caseSensitivity: () => Promise.resolve(undefined),
    identity: (at) => {
      const found = things[at];
      return Promise.resolve(
        found ? { dev: found.dev, ino: String(found.ino) } : null,
      );
    },
    list: (folder) =>
      Promise.resolve(
        Object.keys(things).flatMap((at) =>
          at.startsWith(`${folder}/`) &&
          !at.slice(folder.length + 1).includes("/")
            ? [at.slice(folder.length + 1)]
            : [],
        ),
      ),
    platform: "darwin",
  };
}

describe("reading how a disk compares names", () => {
  // `/Volumes` is on the boot disk, which ignores case; `/Volumes/2024` is
  // a case-sensitive disk mounted there, its own name having no letter.
  const BOOT_AND_EXTERNAL = {
    "/": { dev: 1, ino: 1 },
    "/Volumes": { dev: 1, ino: 2 },
    "/vOLUMES": { dev: 1, ino: 2 },
    "/Volumes/2024": { dev: 2, ino: 1 },
    "/Volumes/2024/Photos": { dev: 2, ino: 5 },
  };

  it("reads a disk mounted under another from what is on it, not from the disk above", async () => {
    expect(await probeNames("/Volumes/2024", disks(BOOT_AND_EXTERNAL))).toEqual(
      { caseSensitive: true, unicodeSensitive: false },
    );
  });

  it("reads a disk that ignores case from a folder on it", async () => {
    expect(await probeNames("/Volumes", disks(BOOT_AND_EXTERNAL))).toEqual({
      caseSensitive: false,
      unicodeSensitive: false,
    });
  });

  it("takes the disk's own answer first", async () => {
    expect(
      await probeNames("/Volumes/2024", {
        ...disks(BOOT_AND_EXTERNAL),
        caseSensitivity: () => Promise.resolve(false),
      }),
    ).toEqual({ caseSensitive: false, unicodeSensitive: false });
  });
});
