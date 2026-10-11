import { type ChatId } from "../../schemas/chat-id";
import { type ChatAppGrant } from "../../schemas/chat-settings";
import { WINDOW_ID } from "../../schemas/window-id";
import { readChatRecord, updateChatRecord } from "../chat-record";
import { getCurrentDate } from "../get-current-date";
import { chatDir } from "../record-folders";
import { type Level } from "./places";
import { readPermissionSettings } from "./rules";

/** Two spellings of an app's name are one app: `"Mail"` and `"mail "`. */
function sameApp(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Whether the agent may control `app` in this chat: a rule in Settings ›
 * Permissions where there is one, an allow where the chat holds a grant for
 * it, and otherwise ask first. A grant only comes from a card, which a closed
 * app never shows, so a grant wins over the rule as a folder's does.
 */
export async function appReach(chatId: ChatId, app: string): Promise<Level> {
  if (chatId !== WINDOW_ID) {
    const grants = await chatAppGrants(chatId);
    if (grants.some((grant) => sameApp(grant.app, app))) {
      return "allow";
    }
  }
  const rule = (await readPermissionSettings()).apps.find((known) =>
    sameApp(known.name, app),
  );
  return rule?.level ?? "ask";
}

async function chatAppGrants(chatId: ChatId): Promise<ChatAppGrant[]> {
  const record = await readChatRecord(chatDir(chatId));
  return record.settings?.appGrants ?? [];
}

/** Lets this chat control `app`. A grant already held stays as it was. */
export async function grantApp(chatId: ChatId, app: string): Promise<void> {
  await updateChatRecord(chatDir(chatId), "settings", (record) => {
    const grants = record.settings?.appGrants ?? [];
    if (grants.some((grant) => sameApp(grant.app, app))) {
      return record.raw;
    }
    return {
      ...record.raw,
      appGrants: [...grants, { app: app.trim(), grantedAt: getCurrentDate() }],
    };
  });
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
 * Ways a script runs code outside the app it tells: a shell, another script,
 * the Objective-C bridge. An allowed script runs outside the native sandbox
 * (an app refuses Apple Events from a sandboxed sender), so one carrying any
 * of these is refused rather than run with the reach of a shell. Read off the
 * script's text, so a script that hides one in a built string gets past it;
 * the card says so for the apps that reach every file.
 */
const RUNS_CODE_OUTSIDE = [
  /\bdo\s+shell\s+script\b/i,
  /\bdoShellScript\b/,
  /\b(?:run|load|store)\s+script\b/i,
  /\buse\s+framework\b/i,
  /\bcurrent\s+application['’]s\b/i,
  /\bsystem\s+attribute\b/i,
  /\bObjC\s*\./,
  /(?:^|[^\w$])\$\s*[.(]/m,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
];

/** The first way a script runs code outside its app, as written in it. */
export function runsCodeOutside(source: string): string | undefined {
  for (const pattern of RUNS_CODE_OUTSIDE) {
    const found = pattern.exec(source)?.[0];
    if (found) {
      return found.trim();
    }
  }
  return undefined;
}
