import { afterEach, describe, expect, it, vi } from "vitest";

const execFileSync = vi.hoisted(() => vi.fn());
const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile, execFileSync }));

const existsSync = vi.hoisted(() => vi.fn());
vi.mock("node:fs", () => ({ default: { existsSync } }));

function applyEnv({
  CC,
  DEVELOPER_DIR,
}: {
  CC: string | undefined;
  DEVELOPER_DIR: string | undefined;
}) {
  if (CC === undefined) {
    delete process.env.CC;
  } else {
    process.env.CC = CC;
  }
  if (DEVELOPER_DIR === undefined) {
    delete process.env.DEVELOPER_DIR;
  } else {
    process.env.DEVELOPER_DIR = DEVELOPER_DIR;
  }
}

/**
 * The helper caches its developer-directory probe per module instance, so each
 * case imports a fresh module and controls platform/env/probe independently.
 */
async function loadCommandLineToolsEnv({
  cc,
  developerDir,
  platform,
  selectedPath,
  selectedPathExists = true,
}: {
  cc?: string;
  developerDir?: string;
  platform: NodeJS.Platform;
  /** What `xcode-select -p` prints, or undefined when it exits non-zero. */
  selectedPath?: string;
  selectedPathExists?: boolean;
}) {
  vi.resetModules();
  execFileSync.mockReset();
  existsSync.mockReset();

  if (selectedPath === undefined) {
    execFileSync.mockImplementation(() => {
      throw new Error("unable to get active developer directory");
    });
  } else {
    execFileSync.mockReturnValue(`${selectedPath}\n`);
  }
  existsSync.mockReturnValue(selectedPathExists);

  const platformSpy = vi
    .spyOn(process, "platform", "get")
    .mockReturnValue(platform);
  const prior = {
    CC: process.env.CC,
    DEVELOPER_DIR: process.env.DEVELOPER_DIR,
  };
  applyEnv({ CC: cc, DEVELOPER_DIR: developerDir });

  const module = await import("./command-line-tools-env");
  const result = module.commandLineToolsEnv();

  platformSpy.mockRestore();
  applyEnv(prior);
  return result;
}

const GUARDED = {
  CC: "/usr/bin/false",
  CXX: "/usr/bin/false",
  DEVELOPER_DIR: "/nonexistent/instrument-command-line-tools-not-installed",
};

describe("commandLineToolsEnv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("points DEVELOPER_DIR at nothing when no developer directory is configured", async () => {
    await expect(
      loadCommandLineToolsEnv({ platform: "darwin" }),
    ).resolves.toEqual(GUARDED);
  });

  it("guards a developer directory that is configured but no longer on disk", async () => {
    await expect(
      loadCommandLineToolsEnv({
        platform: "darwin",
        selectedPath: "/Applications/Xcode.app/Contents/Developer",
        selectedPathExists: false,
      }),
    ).resolves.toEqual(GUARDED);
  });

  it("leaves the env untouched when the tools are installed", async () => {
    await expect(
      loadCommandLineToolsEnv({
        platform: "darwin",
        selectedPath: "/Library/Developer/CommandLineTools",
      }),
    ).resolves.toEqual({});
  });

  it("respects an explicitly configured DEVELOPER_DIR without probing", async () => {
    await expect(
      loadCommandLineToolsEnv({
        developerDir: "/Applications/Xcode-beta.app/Contents/Developer",
        platform: "darwin",
      }),
    ).resolves.toEqual({});
    expect(execFileSync).not.toHaveBeenCalled();
  });

  // applyCommandLineToolsEnv sets the guard on the process itself, and the
  // spawn sites that build a subprocess env from scratch (uv, the shell's
  // native commands) rely on this overlay to carry it back in.
  it("keeps returning the whole guard once it is set on the process", async () => {
    await expect(
      loadCommandLineToolsEnv({
        cc: GUARDED.CC,
        developerDir: GUARDED.DEVELOPER_DIR,
        platform: "darwin",
      }),
    ).resolves.toEqual(GUARDED);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("still guards the stubs when $CC names another toolchain", async () => {
    await expect(
      loadCommandLineToolsEnv({
        cc: "/opt/homebrew/bin/clang",
        platform: "darwin",
      }),
    ).resolves.toEqual({
      DEVELOPER_DIR: GUARDED.DEVELOPER_DIR,
    });
  });

  it("does nothing on non-macOS hosts", async () => {
    await expect(
      loadCommandLineToolsEnv({ platform: "linux" }),
    ).resolves.toEqual({});
    expect(execFileSync).not.toHaveBeenCalled();
  });
});

/** A variable of the env an `execFile` call was given, read off its options. */
function readEnv(options: unknown, name: string): unknown {
  if (
    typeof options === "object" &&
    options !== null &&
    "env" in options &&
    typeof options.env === "object" &&
    options.env !== null
  ) {
    return new Map<string, unknown>(Object.entries(options.env)).get(name);
  }
  return undefined;
}

describe("recheckCommandLineTools", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * A Mac that started without the tools, with the guard on the process as
   * Studio sets it, asked again once `xcode-select -p` prints `selectedPath`.
   */
  async function recheck(selectedPath: string | undefined) {
    vi.resetModules();
    execFile.mockReset();
    existsSync.mockReset();
    existsSync.mockReturnValue(true);
    execFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, result?: { stdout: string }) => void,
      ) =>
        selectedPath === undefined
          ? callback(new Error("unable to get active developer directory"))
          : callback(null, { stdout: `${selectedPath}\n` }),
    );
    const platformSpy = vi
      .spyOn(process, "platform", "get")
      .mockReturnValue("darwin");
    const prior = {
      CC: process.env.CC,
      DEVELOPER_DIR: process.env.DEVELOPER_DIR,
    };
    applyEnv({ CC: GUARDED.CC, DEVELOPER_DIR: GUARDED.DEVELOPER_DIR });
    try {
      const module = await import("./command-line-tools-env");
      const missing = await module.recheckCommandLineTools();
      return {
        env: module.commandLineToolsEnv(),
        missing,
        onProcess: {
          CC: process.env.CC,
          DEVELOPER_DIR: process.env.DEVELOPER_DIR,
        },
        probedWith: execFile.mock.calls.map((call: unknown[]): unknown =>
          readEnv(call[2], "DEVELOPER_DIR"),
        ),
      };
    } finally {
      platformSpy.mockRestore();
      applyEnv(prior);
    }
  }

  it("lifts the guard from the process once the tools are installed", async () => {
    await expect(
      recheck("/Library/Developer/CommandLineTools"),
    ).resolves.toEqual({
      env: {},
      missing: false,
      onProcess: { CC: undefined, DEVELOPER_DIR: undefined },
      // The guard would answer for itself, so the probe runs without it.
      probedWith: [undefined],
    });
  });

  it("keeps it while they are still missing", async () => {
    await expect(recheck(undefined)).resolves.toEqual({
      env: GUARDED,
      missing: true,
      onProcess: { CC: GUARDED.CC, DEVELOPER_DIR: GUARDED.DEVELOPER_DIR },
      probedWith: [undefined],
    });
  });
});
