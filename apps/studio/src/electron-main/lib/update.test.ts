import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Stands in for electron-updater so the module under test can be imported
// outside Electron: the real `autoUpdater` getter builds a platform updater
// that reads the app version during construction.
const autoUpdater = vi.hoisted(() => ({
  autoDownload: true,
  // Not a boolean to begin with, so a test that sees one knows the wiring
  // assigned it rather than finding the value it started from.
  autoInstallOnAppQuit: undefined as boolean | undefined,
  checkForUpdates: vi.fn(),
  disableWebInstaller: false,
  downloadUpdate: vi.fn(),
  forceDevUpdateConfig: false,
  isUpdaterActive: () => true,
  logger: undefined as unknown,
  on: vi.fn(),
  quitAndInstall: vi.fn(),
  setFeedURL: vi.fn(),
}));

vi.mock("electron-updater", () => ({ default: { autoUpdater } }));

vi.mock("electron", () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), "studio-update-test-user-data"),
    getVersion: () => "1.6.6",
    quit: vi.fn(),
  },
}));

vi.mock("@/electron-main/lib/electron-logger", () => ({
  logger: {
    scope: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  },
}));

vi.mock("@/electron-main/stores/preferences", () => ({
  getPreferencesStore: () => ({ get: vi.fn() }),
  setLastUpdateCheck: vi.fn(),
}));

const { createStudioAppUpdater, isDebInstall } = await import("./update");

const resourcesRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "studio-package-type-"),
);

afterAll(() => {
  fs.rmSync(resourcesRoot, { force: true, recursive: true });
});

beforeEach(() => {
  autoUpdater.autoInstallOnAppQuit = undefined;
  vi.spyOn(os, "platform").mockReturnValue("linux");
});

// electron-builder writes the marker beside the app resources, so a build of a
// given package type is reproduced by pointing `resourcesPath` at a directory
// shaped like one. An AppImage has no marker at all.
function packagedAs(packageType: string | undefined) {
  const resources = fs.mkdtempSync(path.join(resourcesRoot, "resources-"));
  if (packageType !== undefined) {
    fs.writeFileSync(path.join(resources, "package-type"), packageType);
  }
  // Electron declares `resourcesPath` read-only, and outside Electron it is not
  // there at all, so it is defined rather than assigned.
  Object.defineProperty(process, "resourcesPath", {
    configurable: true,
    value: resources,
  });
}

describe("isDebInstall", () => {
  it.each([
    { expected: true, packageType: "deb", platform: "linux" },
    // electron-builder writes the marker with a trailing newline.
    { expected: true, packageType: "deb\n", platform: "linux" },
    { expected: false, packageType: "rpm\n", platform: "linux" },
    { expected: false, packageType: "pacman\n", platform: "linux" },
    // An AppImage build ships no marker.
    { expected: false, packageType: undefined, platform: "linux" },
    { expected: false, packageType: "", platform: "linux" },
    { expected: false, packageType: "deb", platform: "darwin" },
    { expected: false, packageType: "deb", platform: "win32" },
  ] satisfies {
    expected: boolean;
    packageType: string | undefined;
    platform: NodeJS.Platform;
  }[])(
    "is $expected for $packageType on $platform",
    ({ expected, packageType, platform }) => {
      expect(isDebInstall({ packageType, platform })).toBe(expected);
    },
  );
});

describe("createStudioAppUpdater", () => {
  it.each([
    { autoInstallOnAppQuit: false, packageType: "deb\n" },
    { autoInstallOnAppQuit: true, packageType: "rpm\n" },
    { autoInstallOnAppQuit: true, packageType: "pacman\n" },
    { autoInstallOnAppQuit: true, packageType: undefined },
  ])(
    "leaves autoInstallOnAppQuit $autoInstallOnAppQuit for $packageType",
    ({ autoInstallOnAppQuit: expected, packageType }) => {
      packagedAs(packageType);

      createStudioAppUpdater();

      // Only the Debian package takes the detached dpkg handoff, so it is the
      // only one that has to stop electron-updater installing on quit. Every
      // other package needs the quit handler, which is the one thing that runs
      // its installer.
      expect(autoUpdater.autoInstallOnAppQuit).toBe(expected);
    },
  );
});
