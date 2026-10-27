import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  StagedUpdateRejectedError,
  type UpdaterPort,
} from "./create-app-updater";

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
  on: vi.fn<(event: string, listener: (info: object) => void) => void>(),
  quitAndInstall: vi.fn(),
  setFeedURL: vi.fn(),
}));

vi.mock("electron-updater", () => ({ default: { autoUpdater } }));

const userData = path.join(os.tmpdir(), "studio-update-test-user-data");
const app = vi.hoisted(() => ({
  getPath: (): string => "",
  getVersion: () => "1.6.6",
  on: vi.fn<(event: string, listener: () => void) => void>(),
  quit: vi.fn(),
}));
app.getPath = () => userData;

// Electron's own updater, which is Squirrel.Mac on macOS.
const nativeUpdater = vi.hoisted(() => ({
  on: vi.fn<(event: string, listener: () => void) => void>(),
}));
const emitNative = (event: string) => {
  for (const [name, listener] of nativeUpdater.on.mock.calls) {
    if (name === event) {
      listener();
    }
  }
};

vi.mock("electron", () => ({
  app,
  autoUpdater: nativeUpdater,
  BrowserWindow: { getAllWindows: () => [] },
}));

// The Debian install hands its script to `sh`, which a test must not run.
const spawn = vi.hoisted(() =>
  vi.fn((_file: string, _args: string[]) => ({ unref: vi.fn() })),
);
vi.mock("node:child_process", () => ({ spawn }));

// The port the app's updater is built on, kept so a test can drive it as the
// updater would.
let port: undefined | UpdaterPort;
vi.mock("@/electron-main/lib/create-app-updater", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./create-app-updater")>();
  return {
    ...actual,
    createAppUpdater: (
      options: Parameters<typeof actual.createAppUpdater>[0],
    ) => {
      port = options.updater;
      return actual.createAppUpdater(options);
    },
  };
});

vi.mock("@/electron-main/lib/electron-logger", () => ({
  logger: {
    scope: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  },
}));

vi.mock("@/electron-main/stores/machine/preferences", () => ({
  getMachinePreferences: () => ({ get: vi.fn() }),
}));
const recordInstallRequest = vi.hoisted(() =>
  vi.fn<(to: null | string) => void>(),
);
vi.mock("@/electron-main/stores/machine/state", () => ({
  recordInstallRequest,
  setLastUpdateCheck: vi.fn(),
}));

const {
  createStudioAppUpdater,
  deferInstallOnQuit,
  installAsksForPassword,
  isDebInstall,
  publishedSha512,
  stagedArtifactProblem,
} = await import("./update");

const resourcesRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "studio-package-type-"),
);

afterAll(() => {
  fs.rmSync(resourcesRoot, { force: true, recursive: true });
});

beforeEach(() => {
  autoUpdater.autoInstallOnAppQuit = undefined;
  vi.spyOn(os, "platform").mockReturnValue("linux");
  vi.clearAllMocks();
  fs.mkdirSync(userData, { recursive: true });
});

afterAll(() => {
  fs.rmSync(userData, { force: true, recursive: true });
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

describe("installAsksForPassword", () => {
  it.each([
    { expected: true, packageType: "deb\n", platform: "linux" },
    { expected: true, packageType: "rpm\n", platform: "linux" },
    { expected: true, packageType: "pacman\n", platform: "linux" },
    // An AppImage build ships no marker and replaces itself.
    { expected: false, packageType: undefined, platform: "linux" },
    { expected: false, packageType: "", platform: "linux" },
    { expected: false, packageType: "deb", platform: "darwin" },
    { expected: false, packageType: "rpm", platform: "win32" },
  ] satisfies {
    expected: boolean;
    packageType: string | undefined;
    platform: NodeJS.Platform;
  }[])(
    "is $expected for $packageType on $platform",
    ({ expected, packageType, platform }) => {
      expect(installAsksForPassword({ packageType, platform })).toBe(expected);
    },
  );
});

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

const sha512 = (contents: string) =>
  createHash("sha512").update(contents).digest("base64");

/** An update staged the way electron-updater leaves one: a file and the feed's entry for it. */
function stagedArtifact(name: string, published: string, onDisk = published) {
  const file = path.join(
    fs.mkdtempSync(path.join(resourcesRoot, "pending-")),
    name,
  );
  fs.writeFileSync(file, onDisk);
  return {
    file,
    info: {
      files: [
        { sha512: sha512(published), url: name },
        { sha512: sha512("other"), url: "Instrument-2.0.0.AppImage" },
      ],
    },
  };
}

describe("publishedSha512", () => {
  const files = [
    { sha512: "deb", url: "Instrument_2.0.0_amd64.deb" },
    {
      sha512: "rpm",
      url: "https://releases.example/Instrument-2.0.0.x86_64.rpm",
    },
    { sha512: "spaced", url: "Instrument%20Preview-2.0.0.AppImage" },
  ];

  it.each([
    ["/cache/pending/Instrument_2.0.0_amd64.deb", "deb"],
    ["/cache/pending/Instrument-2.0.0.x86_64.rpm", "rpm"],
    ["/cache/pending/Instrument Preview-2.0.0.AppImage", "spaced"],
    // electron-updater names a file by its URL unless that lacks the
    // extension, so the one entry of the kind is the one it fetched.
    ["/cache/pending/update.deb", "deb"],
    ["/cache/pending/Instrument-2.0.0.pacman", undefined],
  ])("finds %s's entry", (file, expected) => {
    expect(publishedSha512({ files }, file)).toBe(expected);
  });
});

describe("stagedArtifactProblem", () => {
  it("passes the artifact the feed published", () => {
    expect(
      stagedArtifactProblem(
        stagedArtifact("Instrument_2.0.0_amd64.deb", "deb"),
      ),
    ).toBeUndefined();
  });

  it("names a replaced artifact", () => {
    expect(
      stagedArtifactProblem(
        stagedArtifact("Instrument_2.0.0_amd64.deb", "deb", "planted"),
      ),
    ).toBe(
      `its sha512 is ${sha512("planted")}, and the feed published ${sha512("deb")}`,
    );
  });
});

/**
 * A Linux build that has downloaded `artifact`, reached through the port the
 * updater drives, with electron-updater's events delivered by hand.
 */
function stageOnLinux(
  packageType: string,
  artifact: ReturnType<typeof stagedArtifact>,
) {
  packagedAs(packageType);
  createStudioAppUpdater();
  if (!port) {
    throw new Error("createStudioAppUpdater built no updater");
  }
  const updaterPort = port;
  const handlers = {
    available: vi.fn(),
    canceled: vi.fn(),
    downloaded: vi.fn(),
    failed: vi.fn(),
    notAvailable: vi.fn(),
    progress: vi.fn(),
  };
  updaterPort.subscribe(handlers);
  const downloaded = autoUpdater.on.mock.calls.findLast(
    ([event]) => event === "update-downloaded",
  )?.[1];
  downloaded?.({
    ...artifact.info,
    downloadedFile: artifact.file,
    path: "",
    releaseDate: "2026-10-14T00:00:00.000Z",
    sha512: "",
    version: "2.0.0",
  });
  const quit = app.on.mock.calls.findLast(([event]) => event === "quit")?.[1];
  return {
    downloaded: handlers.downloaded,
    install: () => updaterPort.install(),
    quit: () => quit?.(),
  };
}

describe("installing a staged Linux update", () => {
  it("hands the Debian package to dpkg when it is the published one", () => {
    const artifact = stagedArtifact("Instrument_2.0.0_amd64.deb", "deb");

    stageOnLinux("deb\n", artifact).install();

    expect(spawn).toHaveBeenCalledOnce();
    const script = fs.readFileSync(
      String(spawn.mock.calls[0]?.[1]?.[0]),
      "utf8",
    );
    expect(script).toContain("dpkg -i");
    expect(script).toContain(artifact.file);
    expect(app.quit).toHaveBeenCalledOnce();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("refuses a Debian package replaced since it was downloaded, and removes it", () => {
    const artifact = stagedArtifact(
      "Instrument_2.0.0_amd64.deb",
      "deb",
      "planted",
    );
    const staged = stageOnLinux("deb\n", artifact);

    expect(() => staged.install()).toThrow(StagedUpdateRejectedError);
    expect(spawn).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    // Gone, so electron-updater downloads it again instead of finding it.
    expect(fs.existsSync(artifact.file)).toBe(false);
  });

  it.each(["rpm\n", "pacman\n", undefined])(
    "lets electron-updater install a published %j artifact, and refuses a replaced one",
    (packageType) => {
      const good = stageOnLinux(
        packageType ?? "",
        stagedArtifact("Instrument-2.0.0.x86_64.rpm", "rpm"),
      );
      good.install();
      expect(autoUpdater.quitAndInstall).toHaveBeenCalledOnce();

      autoUpdater.quitAndInstall.mockClear();
      const bad = stageOnLinux(
        packageType ?? "",
        stagedArtifact("Instrument-2.0.0.x86_64.rpm", "rpm", "planted"),
      );
      expect(() => bad.install()).toThrow(StagedUpdateRejectedError);
      expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    },
  );

  // Every Linux package but the Debian one installs from electron-updater's
  // own quit handler when the person quits with an update staged.
  it("turns off the install on quit for a replaced artifact, and leaves it on for the published one", () => {
    stageOnLinux(
      "rpm\n",
      stagedArtifact("Instrument-2.0.0.x86_64.rpm", "rpm"),
    ).quit();
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true);

    const artifact = stagedArtifact(
      "Instrument-2.0.0.x86_64.rpm",
      "rpm",
      "planted",
    );
    stageOnLinux("rpm\n", artifact).quit();
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
    expect(fs.existsSync(artifact.file)).toBe(false);
  });

  it("leaves an AppImage staged for a later quit when a restart defers it", () => {
    stageOnLinux("", stagedArtifact("Instrument-2.0.0.AppImage", "appimage"));
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
    deferInstallOnQuit();
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it("installs on macOS without reading the artifact, which Squirrel checks by its signature", () => {
    vi.mocked(os.platform).mockReturnValue("darwin");
    const artifact = stagedArtifact("Instrument-2.0.0-mac.zip", "zip", "x");

    const staged = stageOnLinux("", artifact);
    emitNative("update-downloaded");
    staged.install();

    expect(autoUpdater.quitAndInstall).toHaveBeenCalledOnce();
    expect(fs.existsSync(artifact.file)).toBe(true);
    // So the next launch can say whether it landed.
    expect(recordInstallRequest).toHaveBeenCalledWith("2.0.0");
  });

  // electron-updater's download lands first, then Squirrel fetches and unpacks
  // it again, deleting the build it staged before; a quit in between relaunches
  // the version that was running.
  it("reports a macOS download only once Squirrel has staged it, and refuses to install before", () => {
    vi.mocked(os.platform).mockReturnValue("darwin");
    const staged = stageOnLinux(
      "",
      stagedArtifact("Instrument-2.0.0-mac.zip", "zip"),
    );

    expect(staged.downloaded).not.toHaveBeenCalled();
    expect(() => staged.install()).toThrow("still getting the update ready");
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();

    emitNative("update-downloaded");
    expect(staged.downloaded).toHaveBeenCalledOnce();
    expect(staged.downloaded.mock.calls[0]?.[0]).toMatchObject({
      version: "2.0.0",
    });
  });

  it("drops a macOS download Squirrel failed to stage", () => {
    vi.mocked(os.platform).mockReturnValue("darwin");
    const staged = stageOnLinux(
      "",
      stagedArtifact("Instrument-2.0.0-mac.zip", "zip"),
    );

    emitNative("error");
    emitNative("update-downloaded");

    expect(staged.downloaded).not.toHaveBeenCalled();
  });
});
