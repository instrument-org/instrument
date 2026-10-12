import { defineCommand } from "just-bash";

import { type ChatId } from "../../schemas/chat-id";
import { getWorkspaceConfig } from "../workspace-config";
import { execShim, mapStreams, shimOutput } from "./exec-shim";
import { resolveCommandContext } from "./utils";

export const CALENDAR_COMMAND = {
  description:
    "Read and add to Calendar and Reminders on this Mac through Apple's own interface, in well under a second; prefer it to osascript for either app. " +
    "`calendar events [--from <date>] [--to <date>] [--calendar <name>] [--search <words>] [--limit <n>]` lists events (today when no dates are given); " +
    "`calendar reminders [--list <name>] [--due-before <date>] [--due-after <date>] [--all] [--search <words>] [--limit <n>]` lists incomplete reminders, or every one with --all; " +
    "`calendar calendars` names every calendar and reminder list with its account and whether it takes additions; " +
    "`calendar add-event --title <t> --start <date> [--end <date>] [--calendar <name>] [--location <l>] [--notes <n>]` and " +
    "`calendar add-reminder --title <t> [--list <name>] [--due <date>] [--notes <n>]` add one. " +
    "When two accounts share a calendar or list name, --account names which. " +
    "A date is today, tomorrow, yesterday, 2026-10-06, or 2026-10-06T14:30 in local time. Answers are JSON. " +
    "macOS asks the user once for each of Calendars and Reminders; exit code 2 means they declined, and only they can change it in System Settings.",
  name: "calendar",
} as const;

export const CONTACTS_COMMAND = {
  description:
    "Look people up in Contacts on this Mac through Apple's own interface, in well under a second; prefer it to osascript. " +
    "`contacts [--search <words>] [--limit <n>]` lists the people whose name, nickname, company, title, email, or phone holds every word, with their emails, phones, and birthday, as JSON. " +
    "macOS asks the user once; exit code 2 means they declined, and only they can change it in System Settings.",
  name: "contacts",
} as const;

/**
 * A command the bundled Mac helper answers, run as a child of the app so
 * macOS asks the user on the app's behalf, and once: the grant then covers
 * every task. `contacts` is one of the helper's subcommands under its own
 * name; `calendar` passes its subcommands through.
 */
export function createMacHelperCommand(
  command: typeof CALENDAR_COMMAND | typeof CONTACTS_COMMAND,
  chatId: ChatId,
) {
  return defineCommand(command.name, async (args, ctx) => {
    const binPath = getWorkspaceConfig().macHelperBinPath;
    if (binPath === undefined) {
      return {
        exitCode: 1,
        stderr: `${command.name} is not available in this build; use osascript instead.\n`,
        stdout: "",
      };
    }
    const { env, taskCwd } = resolveCommandContext(chatId, ctx);
    const result = await execShim(
      binPath,
      command.name === CONTACTS_COMMAND.name ? ["contacts", ...args] : args,
      { cancelSignal: ctx.signal, cwd: taskCwd, env, stdin: "ignore" },
    );
    return {
      exitCode: result.exitCode ?? 1,
      ...mapStreams(shimOutput(result, command.name), (text) => text),
    };
  });
}
