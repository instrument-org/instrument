import { execa } from "execa";
import { type CommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import fs from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import { createComputerCommand, getCuaDriverCandidates } from "./computer";

vi.mock("execa");

const mockCtx: CommandContext = {
  cwd: "/",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
};
const CUA_DRIVER_MACOS_PATH =
  "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";

describe("createComputerCommand", () => {
  const taskId = createMockTaskConfig(TaskIdSchema.parse("computer-test"));
  const command = createComputerCommand(taskId, "darwin", {
    driverPath: CUA_DRIVER_MACOS_PATH,
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns workflow help without invoking the driver", async () => {
    const result = await command.execute(["--help"], mockCtx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("computer list_windows");
    expect(result.stdout).toContain("user's real desktop");
    expect(execa).not.toHaveBeenCalled();
  });

  it.each([
    {
      expected: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
      homeDir: "/Users/test",
      platform: "darwin" as const,
    },
    {
      expected: "/home/test/.local/bin/cua-driver",
      homeDir: "/home/test",
      platform: "linux" as const,
    },
    {
      env: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
      expected:
        "C:\\Users\\test\\AppData\\Local\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe",
      homeDir: "C:\\Users\\test",
      platform: "win32" as const,
    },
  ])("discovers the canonical $platform install", (input) => {
    const candidates = getCuaDriverCandidates({
      env: input.env ?? {},
      homeDir: input.homeDir,
      platform: input.platform,
    });

    expect(candidates).toContain(input.expected);
  });

  it("prefers an explicit driver path over canonical installs", () => {
    const candidates = getCuaDriverCandidates({
      env: { CUA_DRIVER_PATH: "/opt/instrument/cua-driver" },
      homeDir: "/home/test",
      platform: "linux",
    });

    expect(candidates[0]).toBe("/opt/instrument/cua-driver");
  });

  it("shows user-run setup without invoking the driver", async () => {
    const windowsCommand = createComputerCommand(taskId, "win32", {
      driverPath: null,
    });

    const result = await windowsCommand.execute(["setup"], mockCtx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Install from PowerShell");
    expect(result.stdout).toContain("agent must not install");
    expect(execa).not.toHaveBeenCalled();
  });

  it("explains setup when the driver cannot be found", async () => {
    const linuxCommand = createComputerCommand(taskId, "linux", {
      driverPath: null,
    });

    const result = await linuxCommand.execute(["doctor"], mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("not installed or could not be found");
    expect(result.stdout).toContain("Linux also requires a live desktop");
    expect(execa).not.toHaveBeenCalled();
  });

  it("rejects tools outside the proof-of-concept allowlist", async () => {
    const result = await command.execute(["kill_app", '{"pid":123}'], mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("tool 'kill_app' is not available");
    expect(execa).not.toHaveBeenCalled();
  });

  it("requires one JSON object argument", async () => {
    const result = await command.execute(["click", "not-json"], mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("must be valid JSON");
    expect(execa).not.toHaveBeenCalled();
  });

  it("delegates supported tools to cua-driver call", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      all: "windows",
      exitCode: 0,
    } as never);

    const result = await command.execute(
      ["list_windows", '{"on_screen_only":true}'],
      mockCtx,
    );

    expect(result.exitCode).toBe(0);
    expect(execa).toHaveBeenCalledWith(
      CUA_DRIVER_MACOS_PATH,
      ["call", "list_windows", '{"on_screen_only":true}'],
      expect.objectContaining({
        env: expect.objectContaining({
          CUA_DRIVER_RS_TELEMETRY_ENABLED: "0",
        }),
      }),
    );
  });

  it("writes window screenshots under the task's private directory", async () => {
    vi.mocked(execa).mockImplementationOnce((async (
      ...parameters: unknown[]
    ) => {
      const rawArgs = parameters[1];
      const args = Array.isArray(rawArgs)
        ? rawArgs.filter((value): value is string => typeof value === "string")
        : [];
      const screenshotFlagIndex = args.indexOf("--screenshot-out-file");
      const screenshotPath = args[screenshotFlagIndex + 1];
      if (screenshotPath) {
        await fs.writeFile(screenshotPath, "png");
      }
      return { all: "window state", exitCode: 0 } as never;
    }) as never);

    const result = await command.execute(
      ["get_window_state", '{"pid":844,"window_id":10725}'],
      mockCtx,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Screenshot: .instrument/screenshots/");
    expect(execa).toHaveBeenCalledWith(
      CUA_DRIVER_MACOS_PATH,
      expect.arrayContaining(["--screenshot-out-file"]),
      expect.any(Object),
    );
  });

  it("checks the installed driver's permission state", async () => {
    vi.mocked(execa).mockResolvedValueOnce({ all: "ok", exitCode: 0 } as never);

    await command.execute(["permissions"], mockCtx);

    expect(execa).toHaveBeenCalledWith(
      CUA_DRIVER_MACOS_PATH,
      ["permissions", "status"],
      expect.any(Object),
    );
  });

  it("delegates readiness to the stable diagnostics tool", async () => {
    vi.mocked(execa).mockResolvedValueOnce({ all: "ok", exitCode: 0 } as never);

    await command.execute(["doctor"], mockCtx);

    expect(execa).toHaveBeenCalledWith(
      CUA_DRIVER_MACOS_PATH,
      [
        "call",
        "health_report",
        '{"include":["binary_version","platform_supported","session_active","bundle_identity","tcc_accessibility","tcc_screen_recording"]}',
      ],
      expect.any(Object),
    );
  });

  it("falls back to CLI diagnostics for an older driver", async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({
        all: "Unknown tool: health_report",
        exitCode: 64,
      } as never)
      .mockResolvedValueOnce({ all: '{"ok":true}', exitCode: 0 } as never);

    const result = await command.execute(["doctor"], mockCtx);

    expect(result.exitCode).toBe(0);
    expect(execa).toHaveBeenLastCalledWith(
      CUA_DRIVER_MACOS_PATH,
      ["doctor", "--json"],
      expect.any(Object),
    );
  });

  it("uses cross-platform readiness checks outside macOS", async () => {
    const windowsCommand = createComputerCommand(taskId, "win32", {
      driverPath: "C:\\Cua\\cua-driver.exe",
    });

    const result = await windowsCommand.execute(["permissions"], mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("permissions is macOS-only");
    expect(result.stdout).toContain("computer doctor");
    expect(execa).not.toHaveBeenCalled();
  });

  it("explains how the user can start a stopped daemon", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      all: "Cua Driver daemon is not running",
      exitCode: 1,
    } as never);

    const result = await command.execute(["status"], mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Cua Driver daemon is not running");
    expect(result.stdout).toContain(
      `${CUA_DRIVER_MACOS_PATH} permissions grant`,
    );
  });

  it("explains recovery when the driver cannot start", async () => {
    vi.mocked(execa).mockRejectedValueOnce(
      new Error("spawn cua-driver ENOENT"),
    );

    const result = await command.execute(["status"], mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Cua Driver could not be started");
    expect(result.stdout).toContain("computer setup");
  });
});
