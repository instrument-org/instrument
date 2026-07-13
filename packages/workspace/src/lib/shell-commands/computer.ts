import { execa } from "execa";
import { type CommandContext, defineCommand } from "just-bash";
import fs from "node:fs/promises";
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
    "Control native macOS apps in the background through an installed Cua Driver. Run `computer --help` before first use.",
  name: "computer",
} as const;

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
const CUA_DRIVER_MACOS_PATH =
  "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";
const JsonObjectSchema = z.record(z.string(), z.unknown());

const HELP = dedent`
  computer - Control native macOS apps through Cua Driver.

  This command controls the user's real desktop. Target a specific app/window,
  avoid unrelated windows, and inspect state again after each action.

  Prerequisite:
    Install Cua Driver and grant Accessibility + Screen Recording permissions:
    https://cua.ai/docs/cua-driver/guide/getting-started/installation
    From Terminal, run: /Applications/CuaDriver.app/Contents/MacOS/cua-driver permissions grant

  Workflow:
    1. computer list_windows '{"on_screen_only":true}'
    2. computer get_window_state '{"pid":844,"window_id":10725}'
    3. Use element_index values from that state for an action
    4. Re-run get_window_state after the action

  Examples:
    computer launch_app '{"bundle_id":"com.apple.TextEdit"}'
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
    computer status         Check whether the Cua Driver daemon is running
    computer permissions    Check the driver's permission state
    computer --version      Show the installed Cua Driver version
`.trim();

export function createComputerCommand(
  taskId: TaskId,
  platform: NodeJS.Platform = process.platform,
) {
  return defineCommand(COMPUTER_COMMAND.name, async (args, ctx) => {
    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
      return { exitCode: 0, stderr: "", stdout: HELP };
    }

    if (platform !== "darwin") {
      return commandError(
        "computer: this proof of concept currently supports macOS only.",
      );
    }

    if (args[0] === "--version" || args[0] === "-V") {
      return runCuaDriver({ args: ["--version"], ctx, taskId });
    }

    if (args[0] === "permissions") {
      const result = await runCuaDriver({
        args: ["permissions", "status"],
        ctx,
        taskId,
      });
      return withDaemonRecovery(result);
    }

    if (args[0] === "status") {
      const result = await runCuaDriver({ args: ["status"], ctx, taskId });
      return withDaemonRecovery(result);
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

    const result = await runCuaDriver({ args: driverArgs, ctx, taskId });
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

function commandError(message: string) {
  return { exitCode: 1, stderr: "", stdout: `${message}\n` };
}

async function createScreenshotPath(taskId: TaskId) {
  const dir = getScreenshotsDir(taskDir(taskId));
  await fs.mkdir(dir, { recursive: true });
  const timestamp = getCurrentDate().toISOString().replaceAll(/[:.]/g, "-");
  return path.join(dir, `computer-${timestamp}.png`);
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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

async function runCuaDriver({
  args,
  ctx,
  taskId,
}: {
  args: string[];
  ctx: CommandContext;
  taskId: TaskId;
}) {
  const { taskCwd } = resolveCommandContext(taskId, ctx);

  try {
    const result = await execa(CUA_DRIVER_MACOS_PATH, args, {
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
      `computer: Cua Driver is not available.${detail}\nInstall it from https://cua.ai/docs/cua-driver/guide/getting-started/installation`,
    );
  }
}

function withDaemonRecovery(result: {
  exitCode: number;
  stderr: string;
  stdout: string;
}) {
  if (result.exitCode === 0) {
    return result;
  }

  result.stdout = [
    result.stdout,
    "To start Cua Driver and grant its macOS permissions, ask the user to run:",
    `${CUA_DRIVER_MACOS_PATH} permissions grant`,
  ]
    .filter(Boolean)
    .join("\n");
  return result;
}
