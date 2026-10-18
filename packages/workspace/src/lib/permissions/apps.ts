import { APP_NAME } from "@instrument-org/shared";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { type ChatId } from "../../schemas/chat-id";
import { type ChatAppGrant } from "../../schemas/chat-settings";
import { WINDOW_ID } from "../../schemas/window-id";
import { getCurrentDate } from "../get-current-date";
import { type Level } from "./places";
import { type Asker, askFirstNote } from "../chat/asks";
import { chatDenials } from "./denials";
import { readChatPermissions, updateChatPermissions } from "./rules";
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
async function appDenied(chatId: ChatId, app: string): Promise<boolean> {
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
 * An app's grant covers every route to it: the command that drives it, and
 * any other way the agent acts on the app, which asks here by the app's
 * bundle id.
 */
async function appReach(chatId: ChatId, app: string): Promise<Level> {
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

/** A Mac app as its card names it, and as macOS knows it. */
export interface MacApp {
  bundleId: string;
  name: string;
}

/** A service macOS runs an app's work in, as Seatbelt names it. */
export interface AppService {
  kind: "global-name" | "xpc-service-name";
  name: string;
}

/**
 * The person's apps that something other than our commands can reach: each
 * with the programs, by their path, that act through it and so ask for it
 * first (`path-program.ts`), and the services its work runs in, outside
 * every sandbox, which the Seatbelt profile closes until the chat may use it.
 */
export const REACHABLE_APPS: readonly {
  app: MacApp;
  programs: readonly string[];
  services: readonly AppService[];
}[] = [
  {
    app: { bundleId: "com.apple.shortcuts", name: "Shortcuts" },
    programs: ["/usr/bin/shortcuts"],
    // `shortcuts list` asks siriactionsd over VoiceShortcuts' service, and
    // without it fails with "Couldn't communicate with a helper application".
    // The daemon's own service, its runner, and the runner process
    // WorkflowKit starts are closed with it, so a program has no other way to
    // have a shortcut run.
    services: [
      { kind: "global-name", name: "com.apple.siri.VoiceShortcuts.xpc" },
      { kind: "global-name", name: "com.apple.siriactionsd.xpc" },
      {
        kind: "global-name",
        name: "com.apple.shortcuts.systemshortcutservice.runner",
      },
      {
        kind: "xpc-service-name",
        name: "com.apple.WorkflowKit.BackgroundShortcutRunner",
      },
    ],
  },
];

/** The services of every app in `REACHABLE_APPS` that `chatId` may not use. */
export async function closedAppServices(chatId: ChatId): Promise<AppService[]> {
  const closed: AppService[] = [];
  for (const { app, services } of REACHABLE_APPS) {
    if (!(await appAllowed(chatId, app))) {
      closed.push(...services);
    }
  }
  return closed;
}

/** How far the agent may use `app` in this chat, by its name, or its bundle id where the name asks. */
export async function appLevel(chatId: ChatId, app: MacApp): Promise<Level> {
  const byName = await appReach(chatId, app.name);
  return byName === "ask" ? appReach(chatId, app.bundleId) : byName;
}

/** Whether the agent may use `app` in this chat without asking. */
async function appAllowed(chatId: ChatId, app: MacApp): Promise<boolean> {
  return (await appLevel(chatId, app)) === "allow";
}

/**
 * Why the agent may not use `app` in this chat yet, or undefined when it
 * may: the person said not now to it here, Settings › Permissions marks it
 * Not allowed, or nobody has answered for it yet, which the note tells
 * `asker` to ask for. A rule, a grant or a "not now" holds
 * whether it names the app or its bundle id. The card names the app, and so
 * does the rule an Always allow on it writes, which is how Settings lists it.
 */
export async function appRefusal(
  chatId: ChatId,
  app: MacApp,
  asker: Asker | undefined,
): Promise<string | undefined> {
  const level = await appLevel(chatId, app);
  if (level === "allow") {
    return undefined;
  }
  if (level === "never") {
    return (await appDenied(chatId, app.name)) ||
      (await appDenied(chatId, app.bundleId))
      ? `the person said not now to ${app.name} in this chat. Don't look for another way to use it; say what you skipped without it.`
      : `${app.name} is marked Not allowed in Settings › Permissions, so ${APP_NAME} won't use it. Tell the person what you skipped.`;
  }
  if (!asker) {
    return `using ${app.name} needs the person's yes first.`;
  }
  return askFirstNote(`using ${app.name}`, app.name);
}

async function chatAppGrants(chatId: ChatId): Promise<ChatAppGrant[]> {
  return (await readChatPermissions(chatId)).appGrants;
}

/** Lets this chat use `app`. A grant already held stays as it was. */
export async function grantApp(chatId: ChatId, app: string): Promise<void> {
  const bundleId = await appBundleId(app);
  await updateChatPermissions(chatId, (held) => {
    if (
      held.appGrants.some((grant) => isFor({ ...grant, name: grant.app }, app))
    ) {
      return held;
    }
    return {
      ...held,
      appGrants: [
        ...held.appGrants,
        { app: app.trim(), bundleId, grantedAt: getCurrentDate() },
      ],
    };
  });
}

const bundleIds = new Map<string, Promise<string | undefined>>();

/**
 * An app's bundle id, from its name as its card names it: the app Spotlight
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
