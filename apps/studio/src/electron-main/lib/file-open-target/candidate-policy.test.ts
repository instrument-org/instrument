import { describe, expect, it } from "vitest";

import { curateCandidates } from "./candidate-policy";
import { type CandidateApp } from "./types";

function app(
  bundleId: string,
  overrides: Partial<CandidateApp> = {},
): CandidateApp {
  return {
    appName: bundleId,
    appPath: `/Applications/${bundleId}.app`,
    bundleId,
    isDefault: false,
    ...overrides,
  };
}

const names = (apps: CandidateApp[]) => apps.map(({ appName }) => appName);

describe("curateCandidates", () => {
  it("keeps apps with no policy entry", () => {
    const apps = [app("com.example.one"), app("com.example.two")];

    expect(names(curateCandidates(apps, ".md"))).toEqual([
      "com.example.one",
      "com.example.two",
    ]);
  });

  it.each([
    "com.apple.ColorSyncUtility",
    "com.apple.ScriptEditor2",
    "com.apple.dt.Instruments",
  ])("drops %s, which claims types it cannot usefully open", (bundleId) => {
    expect(curateCandidates([app(bundleId)], ".md")).toEqual([]);
  });

  it.each([
    { bundleId: "com.apple.QuickTimePlayerX", ext: ".mov", kept: true },
    { bundleId: "com.apple.QuickTimePlayerX", ext: ".png", kept: false },
    { bundleId: "com.apple.iWork.Numbers", ext: ".csv", kept: true },
    { bundleId: "com.apple.iWork.Numbers", ext: ".md", kept: false },
    { bundleId: "com.apple.iWork.Pages", ext: ".docx", kept: true },
    { bundleId: "com.apple.iWork.Pages", ext: ".md", kept: false },
    { bundleId: "com.apple.dt.Xcode", ext: ".swift", kept: true },
    { bundleId: "com.apple.dt.Xcode", ext: ".json", kept: false },
    { bundleId: "com.apple.iBooksX", ext: ".pdf", kept: true },
    { bundleId: "com.apple.iBooksX", ext: ".png", kept: false },
  ])(
    "restricts $bundleId to the types it opens ($ext kept: $kept)",
    ({ bundleId, ext, kept }) => {
      expect(curateCandidates([app(bundleId)], ext)).toHaveLength(kept ? 1 : 0);
    },
  );

  it.each([
    "com.apple.ColorSyncUtility",
    "com.apple.dt.Xcode",
    "com.apple.iWork.Numbers",
  ])(
    "never removes %s when it is the app the system already uses",
    (bundleId) => {
      // Dropping the default would leave the menu disagreeing with the
      // "Open in {app}" button beside it.
      const apps = [app(bundleId, { isDefault: true })];

      expect(curateCandidates(apps, ".md")).toHaveLength(1);
    },
  );

  it("caps the list so one promiscuous file type can't fill the menu", () => {
    const apps = Array.from({ length: 40 }, (_unused, index) =>
      app(`com.example.app${index}`),
    );

    expect(curateCandidates(apps, ".md")).toHaveLength(16);
  });

  it("keeps the default when the cap would otherwise drop it", () => {
    const apps = [
      ...Array.from({ length: 20 }, (_unused, index) =>
        app(`com.example.app${index}`),
      ),
      app("com.example.system", { isDefault: true }),
    ];

    const curated = curateCandidates(apps, ".md");

    expect(curated).toHaveLength(16);
    expect(names(curated).at(-1)).toBe("com.example.system");
    // The list stays capped: the default displaces an entry rather than
    // extending the menu past MAX_CANDIDATES.
    expect(names(curated).at(-2)).toBe("com.example.app14");
  });

  it("leaves the list alone when the default already survives the cap", () => {
    const apps = Array.from({ length: 20 }, (_unused, index) =>
      app(`com.example.app${index}`, { isDefault: index === 3 }),
    );

    expect(names(curateCandidates(apps, ".md"))).toEqual(
      Array.from({ length: 16 }, (_unused, index) => `com.example.app${index}`),
    );
  });

  it("caps normally when the enumeration reported no default at all", () => {
    const apps = Array.from({ length: 20 }, (_unused, index) =>
      app(`com.example.app${index}`),
    );

    expect(curateCandidates(apps, ".md")).toHaveLength(16);
    expect(names(curateCandidates(apps, ".md")).at(-1)).toBe(
      "com.example.app15",
    );
  });

  it("counts only surviving apps against the cap", () => {
    // Excluded apps are removed before the slice, so a raw list padded with
    // them still yields a full menu.
    const apps = [
      ...Array.from({ length: 20 }, () => app("com.apple.ColorSyncUtility")),
      ...Array.from({ length: 20 }, (_unused, index) =>
        app(`com.example.app${index}`),
      ),
    ];

    expect(curateCandidates(apps, ".md")).toHaveLength(16);
  });

  it("preserves the order the enumeration returned", () => {
    const apps = [
      app("com.example.b"),
      app("com.apple.ColorSyncUtility"),
      app("com.example.a", { isDefault: true }),
    ];

    expect(names(curateCandidates(apps, ".md"))).toEqual([
      "com.example.b",
      "com.example.a",
    ]);
  });
});
