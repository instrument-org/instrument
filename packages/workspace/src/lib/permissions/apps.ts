import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { type ChatId } from "../../schemas/chat-id";
import { type ChatAppGrant } from "../../schemas/chat-settings";
import { WINDOW_ID } from "../../schemas/window-id";
import { readChatRecord, updateChatRecord } from "../chat-record";
import { getCurrentDate } from "../get-current-date";
import { chatDir } from "../record-folders";
import { type Level } from "./places";
import { chatDenials } from "./denials";
import { readPermissionSettings } from "./rules";

const execFileAsync = promisify(execFile);

/** Two spellings of an app's name are one app: `"Mail"` and `"mail "`. */
function sameApp(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Whether a grant or rule, by name and bundle id, is for `app`. */
function isFor(
  known: { bundleId?: string; name: string },
  app: string,
): boolean {
  return (
    sameApp(known.name, app) ||
    (known.bundleId !== undefined && sameApp(known.bundleId, app))
  );
}

/** Whether the person said not now to `app` in this chat. */
export async function appDenied(chatId: ChatId, app: string): Promise<boolean> {
  return (await chatDenials(chatId)).some(
    (denial) => denial.kind === "app" && sameApp(denial.target, app),
  );
}

/**
 * Whether the agent may use `app`, by its name or its bundle id, in this
 * chat: a rule in Settings › Permissions where there is one, an allow where
 * the chat holds a grant for it, and otherwise ask first. A grant only comes
 * from a card, which a closed app never shows, so a grant wins over the rule
 * as a folder's does.
 *
 * An app's grant covers every route to it: a script's Apple Events, and any
 * other way the agent acts on the app, which asks here by the app's bundle
 * id.
 */
export async function appReach(chatId: ChatId, app: string): Promise<Level> {
  const rule = (await readPermissionSettings()).apps.find((known) =>
    isFor(known, app),
  );
  // An Always allow, given in Settings or from any chat's card, outranks a
  // chat's earlier "Not now".
  if (rule?.level !== "allow" && (await appDenied(chatId, app))) {
    return "never";
  }
  if (chatId !== WINDOW_ID) {
    const grants = await chatAppGrants(chatId);
    if (grants.some((grant) => isFor({ ...grant, name: grant.app }, app))) {
      return "allow";
    }
  }
  return rule?.level ?? "ask";
}

async function chatAppGrants(chatId: ChatId): Promise<ChatAppGrant[]> {
  const record = await readChatRecord(chatDir(chatId));
  return record.settings?.appGrants ?? [];
}

/** Lets this chat use `app`. A grant already held stays as it was. */
export async function grantApp(chatId: ChatId, app: string): Promise<void> {
  const bundleId = await appBundleId(app);
  await updateChatRecord(chatDir(chatId), "settings", (record) => {
    const grants = record.settings?.appGrants ?? [];
    if (grants.some((grant) => isFor({ ...grant, name: grant.app }, app))) {
      return record.raw;
    }
    return {
      ...record.raw,
      appGrants: [
        ...grants,
        { app: app.trim(), bundleId, grantedAt: getCurrentDate() },
      ],
    };
  });
}

const bundleIds = new Map<string, Promise<string | undefined>>();

/**
 * An app's bundle id, from its name as a script tells it: the app Spotlight
 * finds by that name, read from its own Info.plist. A name that already is
 * a bundle id answers itself; off macOS, or where no app goes by the name,
 * there is none.
 */
export function appBundleId(app: string): Promise<string | undefined> {
  const name = app.trim();
  if (/^[\w-]+(?:\.[\w-]+){2,}$/.test(name)) {
    return Promise.resolve(name);
  }
  if (process.platform !== "darwin") {
    return Promise.resolve(undefined);
  }
  let known = bundleIds.get(name.toLowerCase());
  if (!known) {
    known = (async () => {
      try {
        const { stdout } = await execFileAsync(
          "/usr/bin/mdfind",
          [
            `kMDItemContentType == "com.apple.application-bundle" && kMDItemFSName == "${name.replaceAll('"', "")}.app"c`,
          ],
          { timeout: 3000 },
        );
        const bundle = stdout.split("\n").find((line) => line.endsWith(".app"));
        if (!bundle) {
          return undefined;
        }
        const id = await execFileAsync(
          "/usr/libexec/PlistBuddy",
          ["-c", "Print :CFBundleIdentifier", `${bundle}/Contents/Info.plist`],
          { timeout: 3000 },
        );
        return id.stdout.trim() || undefined;
      } catch {
        return undefined;
      }
    })();
    bundleIds.set(name.toLowerCase(), known);
  }
  return known;
}

/**
 * The apps a script sends Apple Events to, by the names it tells them by:
 * AppleScript's `tell application "X"` (or `app "X"`, or `application id
 * "x.y.z"`), and JavaScript for Automation's `Application("X")`. A script
 * that names none tells no app anything it can be held to.
 */
export function scriptTargets(source: string): string[] {
  const names = [
    ...source.matchAll(/\bapp(?:lication)?\s+(?:id\s+)?"([^"]+)"/gi),
    ...source.matchAll(/\bApplication\(\s*(["'])([^"']+)\1\s*\)/g),
  ].map((match) => (match[2] ?? match[1] ?? "").trim());
  const unique: string[] = [];
  for (const name of names) {
    if (name && !unique.some((known) => sameApp(known, name))) {
      unique.push(name);
    }
  }
  return unique;
}

/**
 * Apps that reach every file on the computer, or run any command, once they
 * may be controlled.
 */
const REACHES_EVERY_FILE = [
  "Finder",
  "System Events",
  "Terminal",
  "iTerm",
  "iTerm2",
  "com.apple.finder",
  "com.apple.systemevents",
  "com.apple.Terminal",
  "com.googlecode.iterm2",
];

export function reachesEveryFile(app: string): boolean {
  return REACHES_EVERY_FILE.some((known) => sameApp(known, app));
}

/**
 * Ways a script reaches past the app it tells: a shell, a script built or
 * loaded while it runs, a command spelled by its raw four-character code
 * (`«event sysoexec»` is `do shell script`), the Objective-C bridge,
 * Standard Additions' own file reading and writing, or an app named by a
 * value the check cannot read. An allowed script runs outside the native
 * sandbox (an app refuses Apple Events from a sandboxed sender), so one
 * carrying any of these is refused rather than run with the reach of a
 * shell. Read off the script's text: what AppleScript cannot build from a
 * string without `run script` it cannot hide, and JavaScript for
 * Automation, which can, is refused whole for a script to an app
 * (osascript.ts). The card says what the apps that reach every file can
 * do.
 */
const RUNS_CODE_OUTSIDE = [
  /\bdo\s+shell\s+script\b/i,
  /\bdoShellScript\b/,
  /\b(?:run|load|store)\s+script\b/i,
  // « as typed, as a Mac Roman file's byte reads here, and spelled `<<`,
  // which AppleScript rejects today.
  /(?:«|<<|\u00c7)\s*(?:class|constant|data|enum|event|keyword|property|reference|script|type)\b/i,
  /\buse\s+(?:framework|script)\b/i,
  /\bcurrent\s+application['’]s\b/i,
  /\bsystem\s+attribute\b/i,
  /\bObjC\s*\./,
  /(?:^|[^\w$])\$\s*[.(]/m,
  /\bApplication\s*\.\s*currentApplication\b/,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
];

/**
 * The same, matched with the script's string literals emptied, since these
 * are words a note or a message may well hold.
 */
const REACHES_OUTSIDE_IN_CODE = [
  /\bopen\s+for\s+access\b/i,
  /\bwrite\b[^\n]*\bto\b/i,
  // Mail's `read status` is a property, not Standard Additions' `read`.
  /\bread\s+(?!status\b)\S/i,
  /\bincludeStandardAdditions\b/,
  // Standard Additions opening a URL or file in its default app, outside
  // the sandbox: a `.command` file opens in Terminal and runs.
  /\bopen\s+location\b/i,
  // A script library, loaded and run as code.
  /\bscript\s+["']/i,
  // An Objective-C class by name, as the bridge reaches it.
  /\bNS[A-Z][A-Za-z]+\b/,
  // An app named by a variable or an expression, which scriptTargets cannot
  // hold to the allowed apps.
  /(?<!current\s)\bapp(?:lication)?\s+(?!id\s*["']|["'])[\w(]/i,
  /\bApplication\s*\(\s*(?!["'])[^)\s]/,
];

/** A script with every string literal's contents removed. */
function withoutStrings(source: string): string {
  return source.replaceAll(
    /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g,
    (literal) => literal.charAt(0).repeat(2),
  );
}

/** The first way a script runs code outside its app, as written in it. */
export function runsCodeOutside(source: string): string | undefined {
  for (const [patterns, text] of [
    [RUNS_CODE_OUTSIDE, source],
    [REACHES_OUTSIDE_IN_CODE, withoutStrings(source)],
  ] as const) {
    for (const pattern of patterns) {
      const found = pattern.exec(text)?.[0];
      if (found) {
        return found.replaceAll(/\s+/g, " ").trim();
      }
    }
  }
  return undefined;
}
