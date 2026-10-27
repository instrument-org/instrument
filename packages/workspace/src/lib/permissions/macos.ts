import { randomUUID } from "node:crypto";
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
 * How often the window list is read while a look macOS may be asking about
 * waits. A look that answers sooner asks nothing of it.
 */
const PROMPT_POLL_MS = 250;

/**
 * The folders in the home folder macOS asks the person about before the app
 * reads inside them: Desktop, Documents, Downloads and iCloud Drive's. None
 * off macOS.
 */
export function macosGuardedHomeFolders({
  home = os.homedir(),
  platform = process.platform,
}: { home?: string; platform?: NodeJS.Platform } = {}): string[] {
  return platform === "darwin"
    ? ["Desktop", "Documents", "Downloads", "Library/Mobile Documents"].map(
        (name) => nodePath.posix.join(home, name),
      )
    : [];
}

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
  const roots = macosGuardedHomeFolders({ home, platform });
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
 * neither the chat's cards that windows watch, the answers Settings reads,
 * nor the window list: each goes to the main thread instead.
 */
let forward:
  | {
      folderAnswer: (hostPath: string, answer: "allowed" | "denied") => void;
      unwatch: (id: string) => void;
      watch: (id: string, asker: Asker, root: string) => void;
    }
  | undefined;

export function setMacosForwarder(next: NonNullable<typeof forward>): void {
  forward = next;
}

/**
 * Whether one of macOS's own permission prompts is on screen: a window of
 * UserNotificationCenter, the process that draws them, which the window
 * list names without the screen recording permission. False where it can't
 * be told (off macOS, a build without the Mac module).
 */
async function promptOnScreen(): Promise<boolean> {
  const check = getWorkspaceConfig().macosPromptOnScreen;
  return check === undefined ? false : check().catch(() => false);
}

/**
 * Watches for macOS's prompt for as long as `pending` waits, and runs
 * `onAsking` once if it shows: what a look into a folder macOS guards, or a
 * question to macOS about an app, is then waiting on. Resolves whether it
 * showed. Only the prompt on screen counts, never how long the wait takes,
 * so a slow disk or a folder still downloading raises nothing.
 */
export async function watchMacosPrompt(
  pending: Promise<unknown>,
  onAsking: () => Promise<void>,
): Promise<boolean> {
  let settled = false;
  const done = pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  while (!settled) {
    await Promise.race([done, sleep(PROMPT_POLL_MS)]);
    if (!settled && (await promptOnScreen()) && !settled) {
      await onAsking();
      return true;
    }
  }
  return false;
}

/**
 * Watches, while a command's look into `root` waits, for macOS's prompt
 * about it, and raises the chat's card saying macOS is asking the person
 * once the prompt shows. The returned stop is called when the look settles.
 */
export function watchForMacosAsking(asker: Asker, root: string): () => void {
  if (forward) {
    const id = randomUUID();
    forward.watch(id, asker, root);
    return () => {
      forward?.unwatch(id);
    };
  }
  let stop = () => {};
  const pending = new Promise<void>((resolve) => {
    stop = resolve;
  });
  // A command's look runs where just-bash keeps timers from being set, and
  // the watch sets the app's own.
  void DefenseInDepthBox.runTrustedAsync(() =>
    watchMacosPrompt(pending, async () => {
      await recordAsk({ ...asker, waits: true }, "folder", root, {
        allowed: "allowed",
        status: "macos-asking",
      });
    }),
  ).catch(() => {});
  return stop;
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
 * the person about it: `onAsking` runs once when macOS's prompt shows while
 * a look into a folder macOS guards waits, and the look still settles on
 * the person's answer.
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
  // Waited on too, so a card the prompt raised is never marked asking
  // after the answer already settled it.
  const watched = watchMacosPrompt(look, onAsking);
  const looked = await look;
  await watched;
  return looked;
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
 * beside it. Answers the card's id and what the agent is told instead of
 * running into it, or undefined when macOS lets the app in or can't say.
 */
export async function macosAppCard(
  asker: Asker,
  app: MacApp,
  { known }: { known?: "denied" } = {},
): Promise<{ askId: string; message: string } | undefined> {
  // A command asks this while its script runs, where just-bash keeps
  // timers from being set; asking macOS sets the app's own.
  const standing =
    known ??
    (await DefenseInDepthBox.runTrustedAsync(() => macAppStanding(app)));
  if (standing !== "denied" && standing !== "not-asked") {
    return undefined;
  }
  const askId = await recordAsk(asker, "app", app.name, {
    allowed: "allowed",
    status: standing === "denied" ? "macos-refused" : "macos-asking",
  });
  return {
    askId,
    message:
      standing === "denied"
        ? `macOS itself keeps ${APP_NAME} out of ${app.name}, not the person's settings. They now see a card that opens the setting, and their answer wakes you; stop here and say what you're waiting for.`
        : `macOS asks the person before ${APP_NAME} first uses ${app.name}. They now see a card beside the system's prompt, and their answer wakes you; stop here and say what you're waiting for.`,
  };
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

/**
 * How long asking macOS where it stands on an app is waited for while its
 * prompt isn't on screen, after which macOS reads as not saying. A prompt
 * is told by its window, never by this.
 */
const MACOS_STATUS_PATIENCE_MS = 10_000;

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
  // the app is up, so one waiting while that prompt is on screen is it.
  const answer = request
    ? await asked
    : await Promise.race([
        asked,
        new Promise<"not-asked">((resolve) => {
          void watchMacosPrompt(asked, async () => {
            resolve("not-asked");
          });
        }),
        sleep(MACOS_STATUS_PATIENCE_MS).then(() => "unknown" as const),
      ]);
  if (answer === "allowed" || answer === "denied") {
    noteMacAppAnswer(app, answer);
  }
  return answer === "unknown"
    ? (lastAnswers.get(app.bundleId) ?? "unknown")
    : answer;
}
