import { execa } from "execa";
import { type CommandContext, defineCommand } from "just-bash";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dedent } from "radashi";
import { z } from "zod";

import { TASK_FOLDER_NAMES } from "../../constants";
import { type TaskId } from "../../schemas/task-id";
import { filterShellOutput } from "../filter-shell-output";
import { getCurrentDate } from "../get-current-date";
import { getScreenshotsDir, taskDir } from "../task-dir-utils";
import { getWorkspaceConfig } from "../workspace-config";
import { resolveCommandContext } from "./utils";

export const COMPUTER_COMMAND = {
  description:
    "Control native desktop apps through an installed Cua Driver. Run `computer --help` before first use.",
  name: "computer",
} as const;

export type CuaDriverPlatform = "darwin" | "linux" | "win32";

const ALLOWED_TOOLS = new Set([
  "click",
  "double_click",
  "drag",
  "get_accessibility_tree",
  "get_screen_size",
  "get_window_state",
  "hotkey",
  "launch_app",
  "list_apps",
  "list_windows",
  "press_key",
  "right_click",
  "scroll",
  "set_value",
  "type_text",
  "zoom",
]);

const SCREENSHOT_TOOLS = new Set(["get_window_state", "zoom"]);
const CUA_DRIVER_DOCS_URL = "https://cua.ai/docs/how-to-guides/driver/install";
const CUA_DRIVER_MACOS_APP_PATH =
  "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";
const CORE_HEALTH_CHECKS = [
  "binary_version",
  "platform_supported",
  "session_active",
];
const JsonObjectSchema = z.record(z.string(), z.unknown());

export function createComputerCommand(
  taskId: TaskId,
  platform: NodeJS.Platform = process.platform,
  options: {
    driverPath?: null | string;
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
  } = {},
) {
  return defineCommand(COMPUTER_COMMAND.name, async (args, ctx) => {
    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
      return {
        exitCode: 0,
        stderr: "",
        stdout: createHelp(platform),
      };
    }

    if (!isSupportedPlatform(platform)) {
      return commandError(
        `computer: Cua Driver does not support ${platform}. Supported platforms: macOS, Windows, and Linux.`,
      );
    }

    if (args[0] === "setup") {
      return {
        exitCode: 0,
        stderr: "",
        stdout: createSetupInstructions(platform),
      };
    }

    const driverPath =
      "driverPath" in options
        ? options.driverPath
        : await resolveCuaDriverPath({
            env: options.env ?? process.env,
            homeDir: options.homeDir ?? os.homedir(),
            platform,
          });
    if (!driverPath) {
      return commandError(
        `computer: Cua Driver is not installed or could not be found.\n\n${createSetupInstructions(platform)}`,
      );
    }

    if (args[0] === "--version" || args[0] === "-V") {
      return runCuaDriver({
        args: ["--version"],
        ctx,
        driverPath,
        taskId,
      });
    }

    if (args[0] === "doctor") {
      const result = await runCuaDriver({
        args: [
          "call",
          "health_report",
          JSON.stringify({ include: getHealthChecks(platform) }),
        ],
        ctx,
        driverPath,
        taskId,
      });
      if (
        result.exitCode !== 0 &&
        result.stdout.includes("Unknown tool: health_report")
      ) {
        return runCuaDriver({
          args: ["doctor", "--json"],
          ctx,
          driverPath,
          taskId,
        });
      }
      return result;
    }

    if (args[0] === "permissions") {
      if (platform !== "darwin") {
        return commandError(
          "computer: permissions is macOS-only. Run `computer doctor` for cross-platform readiness checks.",
        );
      }
      const result = await runCuaDriver({
        args: ["permissions", "status"],
        ctx,
        driverPath,
        taskId,
      });
      return withDaemonRecovery({ driverPath, platform, result });
    }

    if (args[0] === "status") {
      const result = await runCuaDriver({
        args: ["status"],
        ctx,
        driverPath,
        taskId,
      });
      return withDaemonRecovery({ driverPath, platform, result });
    }

    const toolName = args[0];
    if (!toolName || !ALLOWED_TOOLS.has(toolName)) {
      return commandError(
        `computer: tool '${toolName ?? ""}' is not available. Run \`computer --help\` for the supported tools.`,
      );
    }

    if (args.length > 2) {
      return commandError(
        "computer: pass tool arguments as one quoted JSON object.",
      );
    }

    const input = parseInput(args[1]);
    if (!input.success) {
      return commandError(`computer: ${input.error}`);
    }

    let screenshotPath: string | undefined;
    const driverArgs = ["call", toolName, JSON.stringify(input.value)];
    if (SCREENSHOT_TOOLS.has(toolName)) {
      screenshotPath = await createScreenshotPath(taskId);
      driverArgs.push("--screenshot-out-file", screenshotPath);
    }

    const result = await runCuaDriver({
      args: driverArgs,
      ctx,
      driverPath,
      taskId,
    });
    if (
      screenshotPath &&
      result.exitCode === 0 &&
      (await fileExists(screenshotPath))
    ) {
      const relativePath = path.posix.join(
        TASK_FOLDER_NAMES.private,
        TASK_FOLDER_NAMES.screenshots,
        path.basename(screenshotPath),
      );
      result.stdout = [result.stdout, `Screenshot: ${relativePath}`]
        .filter(Boolean)
        .join("\n");
    }
    return result;
  });
}

export function getCuaDriverCandidates({
  env,
  homeDir,
  platform,
}: {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  platform: CuaDriverPlatform;
}) {
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  const binaryName = platform === "win32" ? "cua-driver.exe" : "cua-driver";
  const candidates: string[] = [];
  const add = (candidate: string | undefined) => {
    if (
      candidate &&
      platformPath.isAbsolute(candidate) &&
      !candidates.includes(candidate)
    ) {
      candidates.push(candidate);
    }
  };

  add(env.CUA_DRIVER_PATH);
  const installDir = env.CUA_DRIVER_RS_INSTALL_DIR ?? env.CUA_DRIVER_BIN_DIR;
  if (installDir) {
    add(platformPath.join(installDir, binaryName));
  }

  switch (platform) {
    case "darwin": {
      add(CUA_DRIVER_MACOS_APP_PATH);
      add(platformPath.join(homeDir, ".local", "bin", binaryName));
      break;
    }
    case "linux": {
      add(platformPath.join(homeDir, ".local", "bin", binaryName));
      const driverHome =
        env.CUA_DRIVER_RS_HOME ?? platformPath.join(homeDir, ".cua-driver");
      add(platformPath.join(driverHome, "packages", "current", binaryName));
      break;
    }
    case "win32": {
      if (env.LOCALAPPDATA) {
        add(
          platformPath.join(
            env.LOCALAPPDATA,
            "Programs",
            "Cua",
            "cua-driver",
            "bin",
            binaryName,
          ),
        );
      }
      break;
    }
  }

  const pathValue = env.PATH ?? env.Path;
  const delimiter = platform === "win32" ? ";" : ":";
  for (const directory of pathValue?.split(delimiter) ?? []) {
    if (directory) {
      add(platformPath.join(directory, binaryName));
    }
  }

  return candidates;
}

function commandError(message: string) {
  return { exitCode: 1, stderr: "", stdout: `${message}\n` };
}

function createHelp(platform: NodeJS.Platform) {
  const platformHelp = isSupportedPlatform(platform)
    ? `\n\n${createSetupInstructions(platform)}`
    : "";

  return dedent`
  computer - Control native desktop apps through Cua Driver.

  This command controls the user's real desktop. Target a specific app/window,
  avoid unrelated windows, and inspect state again after each action.
  Tool availability varies by platform. Treat driver refusals as capability
  boundaries; do not retry an unsafe action through an unrelated window.

  Workflow:
    1. computer doctor
    2. computer list_windows '{"on_screen_only":true}'
    3. computer get_window_state '{"pid":844,"window_id":10725}'
    4. Use element_index values from that state for an action
    5. Re-run get_window_state after the action

  Examples:
    computer click '{"pid":844,"window_id":10725,"element_index":14}'
    computer type_text '{"pid":844,"window_id":10725,"element_index":15,"text":"Hello"}'
    computer press_key '{"pid":844,"key":"return"}'
    computer hotkey '{"pid":844,"keys":["cmd","s"]}'
    computer scroll '{"pid":844,"direction":"down","by":"page","amount":1}'

  Inspection tools:
    list_apps, list_windows, get_window_state, get_accessibility_tree,
    get_screen_size

  Action tools:
    launch_app, click, double_click, right_click, drag, type_text, press_key,
    hotkey, set_value, scroll

  Screenshot tools:
    get_window_state and zoom save an image under .instrument/screenshots/.
    Read that image with read_file when visual inspection is useful.

  Diagnostics:
    computer setup          Show user-run setup instructions for this platform
    computer doctor         Run the driver's cross-platform readiness checks
    computer status         Check whether the optional driver daemon is running
    computer permissions    Check macOS permission state (macOS only)
    computer --version      Show the installed Cua Driver version
  ${platformHelp}`.trim();
}

async function createScreenshotPath(taskId: TaskId) {
  const dir = getScreenshotsDir(taskDir(taskId));
  await fs.mkdir(dir, { recursive: true });
  const timestamp = getCurrentDate().toISOString().replaceAll(/[:.]/g, "-");
  return path.join(dir, `computer-${timestamp}.png`);
}

function createSetupInstructions(platform: CuaDriverPlatform) {
  const heading = dedent`
    Cua Driver setup for ${getPlatformName(platform)}:
    Run these commands yourself in a terminal. The agent must not install
    persistent desktop-control software or grant permissions for you.`;

  switch (platform) {
    case "darwin": {
      return dedent`
        ${heading}

        Install:
          /bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"

        Grant Accessibility and Screen Recording access:
          ${CUA_DRIVER_MACOS_APP_PATH} permissions grant

        Verify:
          computer doctor

        Documentation: ${CUA_DRIVER_DOCS_URL}`;
    }
    case "linux": {
      return dedent`
        ${heading}

        Install:
          /bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"

        Linux also requires a live desktop, AT-SPI, and platform libraries.
        Run the install guide's distro-specific prerequisites, then verify:
          computer doctor

        Documentation: ${CUA_DRIVER_DOCS_URL}`;
    }
    case "win32": {
      return dedent`
        ${heading}

        Install from PowerShell:
          irm https://cua.ai/driver/install.ps1 | iex

        Approve the installer-owned autostart prompt, then verify:
          computer doctor

        Documentation: ${CUA_DRIVER_DOCS_URL}`;
    }
  }
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getHealthChecks(platform: CuaDriverPlatform) {
  if (platform !== "darwin") {
    return CORE_HEALTH_CHECKS;
  }
  return [
    ...CORE_HEALTH_CHECKS,
    "bundle_identity",
    "tcc_accessibility",
    "tcc_screen_recording",
  ];
}

function getPlatformName(platform: CuaDriverPlatform) {
  switch (platform) {
    case "darwin": {
      return "macOS";
    }
    case "linux": {
      return "Linux";
    }
    case "win32": {
      return "Windows";
    }
  }
}

function isSupportedPlatform(
  platform: NodeJS.Platform,
): platform is CuaDriverPlatform {
  return platform === "darwin" || platform === "linux" || platform === "win32";
}

function parseInput(raw: string | undefined) {
  if (raw === undefined) {
    return { success: true as const, value: {} };
  }

  try {
    const value: unknown = JSON.parse(raw);
    const parsed = JsonObjectSchema.safeParse(value);
    if (!parsed.success) {
      return {
        error: "tool arguments must be a JSON object.",
        success: false as const,
      };
    }
    return { success: true as const, value: parsed.data };
  } catch {
    return {
      error: "tool arguments must be valid JSON.",
      success: false as const,
    };
  }
}

async function resolveCuaDriverPath({
  env,
  homeDir,
  platform,
}: {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  platform: CuaDriverPlatform;
}) {
  const candidates = getCuaDriverCandidates({ env, homeDir, platform });
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Keep searching known install locations.
    }
  }
  return null;
}

async function runCuaDriver({
  args,
  ctx,
  driverPath,
  taskId,
}: {
  args: string[];
  ctx: CommandContext;
  driverPath: string;
  taskId: TaskId;
}) {
  const { taskCwd } = resolveCommandContext(taskId, ctx);

  try {
    const result = await execa(driverPath, args, {
      all: true,
      cancelSignal: ctx.signal,
      cwd: taskCwd,
      env: {
        ...getWorkspaceConfig().nodeExecEnv,
        CUA_DRIVER_RS_TELEMETRY_ENABLED: "0",
        CUA_DRIVER_RS_UPDATE_CHECK: "false",
      },
      reject: false,
      stdin: "ignore",
    });

    return {
      exitCode: result.exitCode ?? 1,
      stderr: "",
      stdout: filterShellOutput(result.all, taskDir(taskId)),
    };
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    return commandError(
      `computer: Cua Driver could not be started from ${driverPath}.${detail}\nRun \`computer setup\` for recovery instructions.`,
    );
  }
}

function withDaemonRecovery({
  driverPath,
  platform,
  result,
}: {
  driverPath: string;
  platform: CuaDriverPlatform;
  result: { exitCode: number; stderr: string; stdout: string };
}) {
  if (result.exitCode === 0) {
    return result;
  }

  let recovery: string;
  switch (platform) {
    case "darwin": {
      recovery = dedent`
        To start Cua Driver and grant its macOS permissions, ask the user to run:
        ${driverPath} permissions grant`;
      break;
    }
    case "linux": {
      recovery = dedent`
        The daemon is optional for one-shot calls. To keep Cua Driver running,
        ask the user to start ${driverPath} serve in their desktop session.`;
      break;
    }
    case "win32": {
      recovery = dedent`
        To start the driver in the interactive Windows session, ask the user to run:
        ${driverPath} autostart kick`;
      break;
    }
  }

  result.stdout = [result.stdout, recovery].filter(Boolean).join("\n");
  return result;
}
