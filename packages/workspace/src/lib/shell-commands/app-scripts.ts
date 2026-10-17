import { APP_NAME } from "@instrument-org/shared";
import { type ByteString, type ExecResult } from "just-bash";
import os from "node:os";

import { type ChatId } from "../../schemas/chat-id";
import { appRefusal, type MacApp } from "../permissions/apps";
import {
  hostPathOf,
  unsandboxedOperandRefusal,
  type WorkspaceFsLayout,
} from "../workspace-fs-layout";
import { execShim } from "./exec-shim";
import { type SubcommandInput, type SubcommandShell } from "./subcommands";
import { subprocessStdin } from "./utils";

/**
 * Where macOS keeps it. Not bundled: it ships with every Mac, and the Apple
 * Events it sends are attributed to the app, which is what the system asks
 * the person about.
 */
const OSASCRIPT_PATH = "/usr/bin/osascript";

/** What the app's scripts separate fields and records with: ASCII's unit and record separators. */
const UNIT = "\u001f";
const RECORD = "\u001e";

/**
 * Handlers every script shares, ahead of its own `on run`: the separators,
 * a date as local `YYYY-MM-DDTHH:MM:SS`, text from a value that may be
 * missing, a list joined, and a list that `argv` carries as its length
 * followed by its items.
 */
export const SCRIPT_HELPERS = `property US : character id 31
property RS : character id 30

on two(n)
	return text -2 thru -1 of ("0" & n)
end two

on iso(d)
	if d is missing value then return ""
	return (year of d as text) & "-" & my two((month of d) as integer) & "-" & my two(day of d) & "T" & my two(hours of d) & ":" & my two(minutes of d) & ":" & my two(seconds of d)
end iso

on str(x)
	if x is missing value then return ""
	return x as text
end str

on joined(xs, sep)
	set saved to AppleScript's text item delimiters
	set AppleScript's text item delimiters to sep
	set out to xs as text
	set AppleScript's text item delimiters to saved
	return out
end joined

on takeList(argv, i)
	set n to (item i of argv) as integer
	set xs to {}
	repeat with k from 1 to n
		set end of xs to item (i + k) of argv
	end repeat
	return {xs, i + n + 1}
end takeList
`;

/**
 * What `osascript` is run with: the script as one `-e`, then `--`, then the
 * values in order, which the script reads as `on run argv`. Past `--`,
 * osascript reads nothing as an option, so a value that starts with a dash
 * is a value too.
 */
export function scriptArgv(script: string, values: string[]): string[] {
  return ["-e", script, "--", ...values];
}

/** A list as `takeList` reads it: its length, then its items. */
export function listArgs(values: string[]): string[] {
  return [String(values.length), ...values];
}

/** A script's answer as its records, each a list of fields. */
export function parseRecords(output: string): string[][] {
  return output
    .split(RECORD)
    .filter((record) => record.trim() !== "")
    .map((record) => record.split(UNIT));
}

/**
 * A script's answer that is one record whose last field is free text, such
 * as a message's body, which may hold anything: the first `count - 1` fields,
 * and everything after them as the last.
 */
export function parseRecordWithText(output: string, count: number): string[] {
  const fields = output.split(UNIT);
  return [...fields.slice(0, count - 1), fields.slice(count - 1).join(UNIT)];
}

/**
 * A local time as a script writes it (`2026-10-14T09:05:03`), with this
 * computer's offset from UTC added, as the `calendar` command writes its
 * times; null for an empty one.
 */
export function localIso(text: string): string | null {
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)$/.exec(text);
  if (!match) {
    return null;
  }
  const [year = 0, month = 1, day = 1, hours = 0, minutes = 0, seconds = 0] =
    match.slice(1).map(Number);
  const offset = -new Date(
    year,
    month - 1,
    day,
    hours,
    minutes,
    seconds,
  ).getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, "0");
  return `${text}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}

/** Records as one JSON object per line, or nothing when there are none. */
export function jsonLines(records: object[]): string {
  return records.map((record) => `${JSON.stringify(record)}\n`).join("");
}

/** What the agent piped in, as text with its trailing line breaks dropped. */
export function textFromStdin(stdin: ByteString): string {
  return (subprocessStdin(stdin)?.toString("utf8") ?? "").replace(
    /[\r\n]+$/,
    "",
  );
}

/** `--limit`, a positive whole number, or the default. */
export function limitOf(input: SubcommandInput, fallback = 20): number {
  const given = input.value("limit");
  if (given === undefined) {
    return fallback;
  }
  if (!/^\d+$/.test(given) || Number(given) === 0) {
    throw new Error(`--limit takes a positive number (got "${given}").`);
  }
  return Number(given);
}

/**
 * Files named to go with a message, as the app reads them: each held to the
 * folder rules for reading, as the shell's own commands hold a path, and to
 * them again where a link leads, since the app follows it outside every
 * sandbox; then each has to be a file, and is handed over absolute.
 */
export async function attachmentPaths(
  named: string[],
  shell: SubcommandShell,
  layout: WorkspaceFsLayout,
): Promise<string[]> {
  const paths: string[] = [];
  for (const name of named) {
    const resolved = shell.fs.resolvePath(shell.cwd, name);
    const refusal = unsandboxedOperandRefusal(layout, resolved, "read");
    if (refusal !== undefined) {
      throw new Error(`${name}: Permission denied\n${refusal}`);
    }
    if (!(await shell.fs.exists(resolved))) {
      throw new Error(`no file at ${name} to attach.`);
    }
    if ((await shell.fs.stat(resolved)).isDirectory) {
      throw new Error(`${name} is a folder; attach the files in it instead.`);
    }
    paths.push(hostPathOf(resolved));
  }
  return paths;
}

/** osascript's report of a script that failed: the message and its number. */
const EXECUTION_ERROR =
  /execution error: (?<message>[\s\S]*?) \((?<code>-?\d+)\)\s*$/;

/** The words an app puts ahead of its own error, which say nothing the command doesn't. */
const APP_GOT_AN_ERROR = /^.+? got an error: /;

function failure(command: string, message: string, exitCode = 1): ExecResult {
  return { exitCode, stderr: `${command}: ${message}\n`, stdout: "" };
}

/**
 * Runs one of the app's own scripts against `app`, once the person allows
 * the app in this chat: the script is a constant shipped with the app, and
 * whatever the agent supplied reaches it only as `values`, read as `on run
 * argv`, never as script text. An app takes no Apple Events from a
 * sandboxed sender, so the script runs outside the native sandbox, which is
 * safe only because the script is the app's own. No variable of the agent's
 * shell reaches it.
 *
 * Succeeds with the script's answer, its last line break dropped. A failure
 * is said in words: `errors` for the numbers the script raises itself, and
 * for the system's own, what to do about them. Exit code 2 means macOS was
 * told not to let the app be controlled.
 */
export async function runAppScript({
  app,
  chatId,
  command,
  errors = {},
  layout,
  script,
  signal,
  values,
}: {
  app: MacApp;
  chatId: ChatId;
  command: string;
  errors?: Record<number, string>;
  layout: WorkspaceFsLayout;
  script: string;
  signal?: AbortSignal;
  values: string[];
}): Promise<ExecResult> {
  const refusal = await appRefusal(chatId, app, layout.rules.asker);
  if (refusal !== undefined) {
    return failure(command, `refused: ${refusal}`);
  }
  const result = await execShim(OSASCRIPT_PATH, scriptArgv(script, values), {
    cancelSignal: signal,
    cwd: os.tmpdir(),
    stdin: "ignore",
    unsandboxed: true,
  });
  if (result.exitCode === 0) {
    return {
      exitCode: 0,
      stderr: "",
      stdout: result.stdout.replace(/\n$/, ""),
    };
  }
  const reported = EXECUTION_ERROR.exec(result.stderr.trim())?.groups;
  if (!reported) {
    return failure(
      command,
      result.stderr.trim() ||
        result.shortMessage ||
        `${app.name} failed without saying why.`,
    );
  }
  const code = Number(reported.code);
  const own = errors[code];
  if (own !== undefined) {
    return failure(command, own);
  }
  switch (code) {
    case -1743: {
      return failure(
        command,
        `macOS isn't letting ${APP_NAME} control ${app.name}, because the person said no when it asked. Only they can change that, under System Settings › Privacy & Security › Automation.`,
        2,
      );
    }
    case -1712: {
      return failure(
        command,
        `${app.name} took too long to answer. It may be busy or showing a dialog; try again, or ask the person to look at ${app.name}.`,
      );
    }
    case -600:
    case -609: {
      return failure(
        command,
        `${app.name} quit or couldn't be opened. Try again; if it fails again, ask the person to open ${app.name}.`,
      );
    }
    default: {
      return failure(
        command,
        (reported.message ?? "").replace(APP_GOT_AN_ERROR, "").trim(),
      );
    }
  }
}
