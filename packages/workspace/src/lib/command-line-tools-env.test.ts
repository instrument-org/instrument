import { afterEach, describe, expect, it, vi } from "vitest";

const execFileSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFileSync }));

const existsSync = vi.hoisted(() => vi.fn());
vi.mock("node:fs", () => ({ default: { existsSync } }));

const GUARDED = {
  DEVELOPER_DIR: "/nonexistent/instrument-command-line-tools-not-installed",
};

/**
 * The helper remembers a found developer directory per module instance, so
 * each case imports a fresh module and controls platform/env/probe
 * independently. `probes` lists what `xcode-select -p` prints on each call in
 * turn, undefined for a call that exits non-zero.
 */
async function loadCommandLineToolsEnv({
  calls = 1,
  developerDir,
  platform,
  probes = [undefined],
  selectedPathExists = true,
}: {
  calls?: number;
  developerDir?: string;
  platform: NodeJS.Platform;
  probes?: (string | undefined)[];
  selectedPathExists?: boolean;
}) {
  vi.resetModules();
  execFileSync.mockReset();
  existsSync.mockReset();
  for (const printed of probes) {
    execFileSync.mockImplementationOnce(() => {
      if (printed === undefined) {
        throw new Error("unable to get active developer directory");
      }
      return `${printed}\n`;
    });
  }
  existsSync.mockReturnValue(selectedPathExists);

  const platformSpy = vi
    .spyOn(process, "platform", "get")
    .mockReturnValue(platform);
  const prior = process.env.DEVELOPER_DIR;
  if (developerDir === undefined) {
    delete process.env.DEVELOPER_DIR;
  } else {
    process.env.DEVELOPER_DIR = developerDir;
  }
  try {
    const module = await import("./command-line-tools-env");
    return Array.from({ length: calls }, () => module.commandLineToolsEnv());
  } finally {
    platformSpy.mockRestore();
    if (prior === undefined) {
      delete process.env.DEVELOPER_DIR;
    } else {
      process.env.DEVELOPER_DIR = prior;
    }
  }
}

describe("commandLineToolsEnv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("points DEVELOPER_DIR at nothing when no developer directory is configured", async () => {
    await expect(
      loadCommandLineToolsEnv({ platform: "darwin" }),
    ).resolves.toEqual([GUARDED]);
  });

  it("guards a developer directory that is configured but no longer on disk", async () => {
    await expect(
      loadCommandLineToolsEnv({
        platform: "darwin",
        probes: ["/Applications/Xcode.app/Contents/Developer"],
        selectedPathExists: false,
      }),
    ).resolves.toEqual([GUARDED]);
  });

  it("leaves the env untouched when the tools are installed", async () => {
    await expect(
      loadCommandLineToolsEnv({
        platform: "darwin",
        probes: ["/Library/Developer/CommandLineTools"],
      }),
    ).resolves.toEqual([{}]);
  });

  it("finds tools installed since it last asked, and stops asking", async () => {
    await expect(
      loadCommandLineToolsEnv({
        calls: 3,
        platform: "darwin",
        probes: [undefined, "/Library/Developer/CommandLineTools"],
      }),
    ).resolves.toEqual([GUARDED, {}, {}]);
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });

  it("respects an explicitly configured DEVELOPER_DIR without probing", async () => {
    await expect(
      loadCommandLineToolsEnv({
        developerDir: "/Applications/Xcode-beta.app/Contents/Developer",
        platform: "darwin",
      }),
    ).resolves.toEqual([{}]);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("does nothing on non-macOS hosts", async () => {
    await expect(
      loadCommandLineToolsEnv({ platform: "linux" }),
    ).resolves.toEqual([{}]);
    expect(execFileSync).not.toHaveBeenCalled();
  });
});
