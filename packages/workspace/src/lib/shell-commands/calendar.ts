import { defineCommand } from "just-bash";

import { type TaskId } from "../../schemas/task-id";
import { getWorkspaceConfig } from "../workspace-config";
import { execShim, mapStreams, shimOutput } from "./exec-shim";
import { resolveCommandContext } from "./utils";

export const CALENDAR_COMMAND = {
  description:
    "Read and add to Calendar and Reminders on this Mac through Apple's own interface, in well under a second; prefer it to osascript for either app. " +
    "`calendar events [--from <date>] [--to <date>] [--calendar <name>]` lists events (today when no dates are given); " +
    "`calendar reminders [--list <name>] [--due-before <date>] [--due-after <date>] [--all]` lists incomplete reminders, or every one with --all; " +
    "`calendar calendars` names every calendar and reminder list with its account; " +
    "`calendar add-event --title <t> --start <date> [--end <date>] [--calendar <name>] [--location <l>] [--notes <n>]` and " +
    "`calendar add-reminder --title <t> [--list <name>] [--due <date>] [--notes <n>]` add one. " +
    "A date is today, tomorrow, yesterday, 2026-10-06, or 2026-10-06T14:30 in local time. Answers are JSON. " +
    "macOS asks the user once for each of Calendars and Reminders; exit code 2 means they declined, and only they can change it in System Settings.",
  name: "calendar",
} as const;

/**
 * The bundled EventKit helper, run as a child of the app so macOS asks the
 * user on the app's behalf, and once: the grant then covers every task.
 */
export function createCalendarCommand(taskId: TaskId) {
  return defineCommand(CALENDAR_COMMAND.name, async (args, ctx) => {
    const binPath = getWorkspaceConfig().eventKitBinPath;
    if (binPath === undefined) {
      return {
        exitCode: 1,
        stderr: `${CALENDAR_COMMAND.name} is not available in this build; use osascript with Calendar or Reminders instead.\n`,
        stdout: "",
      };
    }
    const { env, taskCwd } = resolveCommandContext(taskId, ctx);
    const result = await execShim(binPath, args, {
      cancelSignal: ctx.signal,
      cwd: taskCwd,
      env,
      stdin: "ignore",
    });
    return {
      exitCode: result.exitCode ?? 1,
      ...mapStreams(shimOutput(result, CALENDAR_COMMAND.name), (text) => text),
    };
  });
}
