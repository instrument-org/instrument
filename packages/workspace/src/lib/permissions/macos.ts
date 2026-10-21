import os from "node:os";
import nodePath from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { APP_NAME } from "@instrument-org/shared";
import { DefenseInDepthBox } from "just-bash";

import { type Asker, recordAsk } from "../chat/asks";
import { listFolder } from "../chat/folder-look";
import { getWorkspaceConfig } from "../workspace-config";
import { type MacApp } from "./apps";

/**
 * How long a look inside a folder macOS guards may take before it counts as
 * macOS asking the person: a listing there waits for their answer to the
 * system's prompt, while one macOS has answered for comes back at once.
 */
export const MACOS_ASKING_MS = 1000;

/**
 * The folder macOS asks the person about when the app reaches `hostPath`,
 * which the person can then open to the app from its folder panel or System
 * Settings: Desktop, Documents, Downloads, iCloud Drive, or a disk under
 * `/Volumes`. None elsewhere, and none off macOS.
 */
export function macosGuardedRoot(
  hostPath: string,
  {
    home = os.homedir(),
    platform = process.platform,
  }: { home?: string; platform?: NodeJS.Platform } = {},
): string | undefined {
  if (platform !== "darwin") {
    return undefined;
  }
  const roots = [
    "Desktop",
    "Documents",
    "Downloads",
    nodePath.join("Library", "Mobile Documents"),
  ].map((name) => nodePath.join(home, name));
  const root = roots.find(
    (candidate) =>
      hostPath === candidate || hostPath.startsWith(`${candidate}/`),
  );
  return root ?? /^\/Volumes\/[^/]+/.exec(hostPath)?.[0];
}

/**
 * What macOS last answered for each folder it guards, by that folder, as the
 * app's own looks and reads found. Asking it fresh would raise its prompt
 * for a folder nobody answered yet, so a page that only shows the standing
 * reads this instead.
 */
const folderAnswers = new Map<string, "allowed" | "denied">();

/**
 * Set in the bash worker, whose shell meets macOS's answers but holds
 * neither the chat's cards that windows watch nor the answers Settings
 * reads: each one goes to the main thread instead.
 */
let forward:
  | {
      asking: (asker: Asker, root: string) => void;
      folderAnswer: (hostPath: string, answer: "allowed" | "denied") => void;
    }
  | undefined;

export function setMacosForwarder(next: NonNullable<typeof forward>): void {
  forward = next;
}

/**
 * Raises the chat's card saying macOS is asking the person about `root`,
 * for a command of the person's that waits on that prompt.
 */
export async function raiseMacosAsking(
  asker: Asker,
  root: string,
): Promise<void> {
  if (forward) {
    forward.asking(asker, root);
    return;
  }
  await recordAsk(asker, "folder", root, {
    allowed: "allowed",
    status: "macos-asking",
  });
}

/** Records what a look or read inside `hostPath` learned of macOS's answer. */
export function noteMacosFolderAnswer(
  hostPath: string,
  answer: "allowed" | "denied",
): void {
  if (forward) {
    forward.folderAnswer(hostPath, answer);
    return;
  }
  const root = macosGuardedRoot(hostPath);
  if (root !== undefined) {
    folderAnswers.set(root, answer);
  }
}

/** The folders macOS guards that it last refused the app, by that folder. */
export function macosRefusedFolders(): string[] {
  return [...folderAnswers]
    .filter(([, answer]) => answer === "denied")
    .map(([root]) => root);
}

/**
 * The card a folder macOS refused takes: one the person can open from the
 * card, or one only Full Disk Access opens (Mail's or Messages' folder, an
 * app's container), which Instrument never asks for, so its card offers no
 * way in.
 */
export function macosRefusalStatus(
  hostPath: string,
): "macos-private" | "macos-refused" {
  return macosGuardedRoot(hostPath) === undefined
    ? "macos-private"
    : "macos-refused";
}

/**
 * A look inside `folder` as the app, which waits as long as macOS is asking
 * the person about it: `onAsking` runs once when the look into a folder
 * macOS guards hasn't answered within {@link MACOS_ASKING_MS}, and the look
 * still settles on the person's answer.
 */
export async function lookAsTheApp(
  folder: string,
  onAsking: () => Promise<void>,
): ReturnType<typeof listFolder> {
  const look = listFolder(folder).then((looked) => {
    if (looked === "open" || looked === "system") {
      noteMacosFolderAnswer(folder, looked === "open" ? "allowed" : "denied");
    }
    return looked;
  });
  if (macosGuardedRoot(folder) === undefined) {
    return look;
  }
  const early = await Promise.race([
    look,
    sleep(MACOS_ASKING_MS).then(() => "waiting" as const),
  ]);
  if (early !== "waiting") {
    return early;
  }
  await onAsking();
  return look;
}

/**
 * The apps the app reaches through a permission macOS keeps: Calendar,
 * Reminders and Contacts by their data's privacy settings (the helper), and
 * Mail, Notes and Messages by controlling them (the app's scripts). Asking
 * macOS about any other app would raise a prompt nothing needs.
 */
const MACOS_PERMISSION_APPS: ReadonlySet<string> = new Set([
  "com.apple.AddressBook",
  "com.apple.MobileSMS",
  "com.apple.Notes",
  "com.apple.iCal",
  "com.apple.mail",
  "com.apple.reminders",
]);

/**
 * Raises the chat's card for what macOS says about `app`, which the
 * person's rules already allow, when it keeps the app out: refused, with
 * the way to the setting, or not asked yet, which the card has macOS ask
 * beside it. Answers what the agent is told instead of running into it, or
 * undefined when macOS lets the app in or can't say.
 */
export async function macosAppCard(
  asker: Asker | undefined,
  app: MacApp,
  { known }: { known?: "denied" } = {},
): Promise<string | undefined> {
  // A command asks this while its script runs, where just-bash keeps
  // timers from being set; asking macOS sets the app's own.
  const standing =
    known ??
    (await DefenseInDepthBox.runTrustedAsync(() => macAppStanding(app)));
  if (standing !== "denied" && standing !== "not-asked") {
    return undefined;
  }
  if (asker !== undefined) {
    await recordAsk(asker, "app", app.name, {
      allowed: "allowed",
      status: standing === "denied" ? "macos-refused" : "macos-asking",
    });
  }
  return standing === "denied"
    ? `macOS itself keeps ${APP_NAME} out of ${app.name}, not the person's settings. They now see a card that opens the setting, and their answer wakes you; stop here and say what you're waiting for.`
    : `macOS asks the person before ${APP_NAME} first uses ${app.name}. They now see a card beside the system's prompt, and their answer wakes you; stop here and say what you're waiting for.`;
}

/** What macOS last said about each app, by bundle id, for when it can't say now. */
const lastAnswers = new Map<string, "allowed" | "denied">();

/** Records what a command just learned of macOS's answer for `app`. */
export function noteMacAppAnswer(
  app: MacApp,
  answer: "allowed" | "denied",
): void {
  lastAnswers.set(app.bundleId, answer);
}

/** How long asking macOS where it stands on an app may take before it counts as macOS asking the person. */
const MACOS_STATUS_MS = 2000;

/**
 * Where macOS stands on the app reaching `app`, or the last answer seen
 * when macOS can't say now (an app it answers for only while it runs).
 * `request` raises the system's prompt when nobody has answered it, and
 * waits for their answer.
 */
export async function macAppStanding(
  app: MacApp,
  { request = false }: { request?: boolean } = {},
): Promise<"allowed" | "denied" | "not-asked" | "unknown"> {
  const access = getWorkspaceConfig().macAppAccess;
  if (access === undefined || !MACOS_PERMISSION_APPS.has(app.bundleId)) {
    return "unknown";
  }
  const asked = access(app, { request }).catch(() => "unknown" as const);
  // macOS holds a check that asks nothing for as long as its own prompt for
  // the app is up, so one that hasn't answered in a moment is that prompt.
  const answer = request
    ? await asked
    : await Promise.race([
        asked,
        sleep(MACOS_STATUS_MS).then(() => "not-asked" as const),
      ]);
  if (answer === "allowed" || answer === "denied") {
    noteMacAppAnswer(app, answer);
  }
  return answer === "unknown"
    ? (lastAnswers.get(app.bundleId) ?? "unknown")
    : answer;
}
