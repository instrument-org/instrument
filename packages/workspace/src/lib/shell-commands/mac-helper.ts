import { defineCommand } from "just-bash";

import { type ChatId } from "../../schemas/chat-id";
import { appRefusal, type MacApp } from "../permissions/apps";
import { getWorkspaceConfig } from "../workspace-config";
import { type WorkspaceFsLayout } from "../workspace-fs-layout";
import { execShim, mapStreams, shimOutput } from "./exec-shim";
import { INSTRUMENT_COMMAND } from "./instrument-command";
import { resolveCommandContext } from "./utils";

export const CALENDAR_COMMAND = {
  description:
    "Read and add to Calendar and Reminders on this Mac through Apple's own interface, in well under a second. " +
    "`instrument calendar events [--from <date>] [--to <date>] [--calendar <name>] [--search <words>] [--limit <n>]` lists events (today when no dates are given); " +
    "`instrument calendar reminders [--list <name>] [--due-before <date>] [--due-after <date>] [--all] [--search <words>] [--limit <n>]` lists incomplete reminders, or every one with --all; " +
    "`instrument calendar calendars` names every calendar, and `instrument calendar lists` every reminder list, with its account and whether it takes additions; " +
    "`instrument calendar add-event --title <t> --start <date> [--end <date>] [--calendar <name>] [--location <l>] [--notes <n>]` and " +
    "`instrument calendar add-reminder --title <t> [--list <name>] [--due <date>] [--notes <n>]` add one. " +
    "When two accounts share a calendar or list name, --account names which. " +
    "A date is today, tomorrow, yesterday, 2026-10-06, or 2026-10-06T14:30 in local time. Answers are JSON. " +
    "The first time a chat uses Calendar or Reminders the person is asked to allow it, and macOS asks them once for each; exit code 2 means macOS was told no, which only they can change in System Settings.",
  name: `${INSTRUMENT_COMMAND.name} calendar`,
  summary: "Read and add to Calendar and Reminders.",
  word: "calendar",
} as const;

export const CONTACTS_COMMAND = {
  description:
    "Look people up in Contacts on this Mac through Apple's own interface, in well under a second. " +
    "`instrument contacts [--search <words>] [--limit <n>]` lists the people whose name, nickname, company, title, email, or phone holds every word, with their emails, phones, and birthday, as JSON. " +
    "The first time a chat uses Contacts the person is asked to allow it, and macOS asks them once; exit code 2 means macOS was told no, which only they can change in System Settings.",
  name: `${INSTRUMENT_COMMAND.name} contacts`,
  summary: "Look people up in Contacts.",
  word: "contacts",
} as const;

const CALENDAR_APP: MacApp = { bundleId: "com.apple.iCal", name: "Calendar" };
const REMINDERS_APP: MacApp = {
  bundleId: "com.apple.reminders",
  name: "Reminders",
};
const CONTACTS_APP: MacApp = {
  bundleId: "com.apple.AddressBook",
  name: "Contacts",
};

/** The helper's subcommands `instrument calendar` passes through, by the app each reads or adds to. */
const CALENDAR_SUBCOMMANDS: Record<string, MacApp> = {
  "add-event": CALENDAR_APP,
  "add-reminder": REMINDERS_APP,
  calendars: CALENDAR_APP,
  events: CALENDAR_APP,
  lists: REMINDERS_APP,
  reminders: REMINDERS_APP,
};

function refusal(command: string, message: string) {
  return { exitCode: 1, stderr: `${command}: ${message}\n`, stdout: "" };
}

/**
 * A command the bundled Mac helper answers, run as a child of the app so
 * macOS asks the user on the app's behalf, and once: the grant then covers
 * every task. Before that, the app it reads is held to the person's own
 * answer for this chat, as every route into one of their apps is.
 * `instrument contacts` runs the helper's `contacts` subcommand;
 * `instrument calendar` passes its own subcommands through, and only those, so it
 * reaches nothing of the helper's but Calendar and Reminders.
 */
export function createMacHelperCommand(
  command: typeof CALENDAR_COMMAND | typeof CONTACTS_COMMAND,
  chatId: ChatId,
  layout: WorkspaceFsLayout,
) {
  return defineCommand(command.name, async (args, ctx) => {
    const binPath = getWorkspaceConfig().macHelperBinPath;
    if (binPath === undefined) {
      return refusal(
        command.name,
        `not available in this build, which has no other way into ${command === CALENDAR_COMMAND ? "Calendar and Reminders" : "Contacts"}. Tell the person what you couldn't do.`,
      );
    }
    const [subcommand] = args;
    const app =
      command === CONTACTS_COMMAND
        ? CONTACTS_APP
        : subcommand !== undefined &&
            Object.hasOwn(CALENDAR_SUBCOMMANDS, subcommand)
          ? CALENDAR_SUBCOMMANDS[subcommand]
          : undefined;
    if (app === undefined) {
      return refusal(
        command.name,
        `takes ${Object.keys(CALENDAR_SUBCOMMANDS).toSorted().join(", ")} (got ${subcommand === undefined ? "nothing" : `"${subcommand}"`}).`,
      );
    }
    const refused = await appRefusal(chatId, app, layout.rules.asker);
    if (refused !== undefined) {
      return refusal(command.name, `refused: ${refused}`);
    }
    const { env, hostCwd } = resolveCommandContext(chatId, ctx);
    const result = await execShim(
      binPath,
      command === CONTACTS_COMMAND ? ["contacts", ...args] : args,
      { cancelSignal: ctx.signal, cwd: hostCwd, env, stdin: "ignore" },
    );
    return {
      exitCode: result.exitCode ?? 1,
      ...mapStreams(shimOutput(result, command.name), (text) => text),
    };
  });
}
