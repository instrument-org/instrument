import {
  type FinderEntry,
  FinderEntrySchema,
} from "@instrument-org/workspace/electron";
import { app } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

/**
 * The Mac bridge, in two halves behind one door, macOS only.
 *
 * - The module (`instrument-mac.node`), loaded into this process, answers what
 *   macOS keys to the app itself: notification permission belongs to the
 *   bundle that shows the notification, so a separate process would be asked
 *   about the wrong app.
 *   It also answers what the file browser asks of every folder it lists,
 *   which comes too often to start a process for.
 * - The helper (`instrument-mac`), run as a child, answers about data:
 *   Calendar, Reminders, Contacts. macOS asks on the app's behalf, so a
 *   grant covers both the agent's `instrument calendar`/`contacts` commands and the
 *   setup page that asks ahead of them.
 *
 * To add a capability: a block in `FUNCTIONS` (native/mac-helper/addon/
 * addon.m) or a command in the helper (native/mac-helper/Sources), a typed
 * wrapper here that parses its JSON, and a route in rpc/routes/mac.ts.
 * Both halves are built by `pnpm build:mac-helper` and land in
 * Resources/bin when packaged.
 */

const BUILD_DIR = path.resolve(
  import.meta.dirname,
  "../../native/mac-helper/.build/bridge",
);

/** A file of the bridge: in the app's resources when packaged, from the build in a checkout. */
function bridgeFile(name: string): string | undefined {
  if (process.platform !== "darwin") {
    return undefined;
  }
  const file = app.isPackaged
    ? path.join(process.resourcesPath, "bin", name)
    : path.join(BUILD_DIR, name);
  return existsSync(file) ? file : undefined;
}

/**
 * The helper behind the agent's `instrument calendar` and `contacts` commands, when this
 * build carries it and this Mac can run it: it is built for macOS 14 (Darwin
 * 23), and an older loader refuses it outright.
 */
export function macHelperBinPath(): string | undefined {
  if (Number.parseInt(os.release(), 10) < 23) {
    return undefined;
  }
  return bridgeFile("instrument-mac");
}

/**
 * The Mac apps' MCP server, built beside the main process's own entry
 * (`electron.vite.config.ts`), which the app runs as Node by its own
 * executable.
 */
export function macAppsServerPath(): string {
  return path.join(app.getAppPath(), "out", "main", "mac-apps-server.js");
}

/**
 * The launcher every native command starts through under Seatbelt
 * (`native/mac-helper/seatbelt`), when this build carries it.
 */
export function seatbeltHelperPath(): string | undefined {
  return bridgeFile("instrument-seatbelt");
}

interface MacModule {
  fileIcon: (path: string, pixels: string) => Promise<string>;
  finderEntries: (folder: string) => Promise<string>;
  pasteboardFiles: () => Promise<string>;
  renameExclusive: (from: string, to: string) => Promise<string>;
  caseSensitivity: (path: string) => Promise<string>;
  trashItem: (path: string) => Promise<string>;
  resolveAlias: (path: string) => Promise<string>;
  notificationStatus: () => Promise<string>;
  requestNotifications: () => Promise<string>;
  automationStatus: (bundleId: string, request: string) => Promise<string>;
  promptOnScreen: () => Promise<string>;
  bundleIdentifier: () => Promise<string>;
}

/** The Mac's own apps whose data has privacy settings of its own, by bundle id. */
const APP_DATA_KINDS: Record<string, DataKind> = {
  "com.apple.AddressBook": "contacts",
  "com.apple.iCal": "calendars",
  "com.apple.reminders": "reminders",
};

/**
 * Where macOS stands on the app reaching `target`: Calendar, Reminders and
 * Contacts by their data's privacy settings (the helper), any other app by
 * whether it may be controlled (the module, since the app's own process
 * holds the Apple Events entitlement). `request` raises the prompt nobody
 * answered yet and waits for the answer. A running app alone is answered
 * for under Automation, so one that is closed is `unknown`.
 */
export async function macAppAccess(
  target: { bundleId: string; name: string },
  { request }: { request: boolean },
): Promise<"allowed" | "denied" | "not-asked" | "unknown"> {
  const kind = Object.hasOwn(APP_DATA_KINDS, target.bundleId)
    ? APP_DATA_KINDS[target.bundleId]
    : undefined;
  if (kind !== undefined) {
    const { status } = await dataAccess(kind, { request });
    switch (status) {
      case "allowed":
      case "not-asked":
        return status;
      case "denied":
      case "restricted":
      case "write-only":
        return "denied";
      default:
        return "unknown";
    }
  }
  const native = loadModule();
  if (!native) {
    return "unknown";
  }
  const answer = z
    .union([
      z.object({
        status: z.enum([
          "allowed",
          "denied",
          "not-asked",
          "not-running",
          "unknown",
        ]),
      }),
      z.object({ error: z.string() }),
    ])
    .parse(
      JSON.parse(
        await native.automationStatus(
          target.bundleId,
          request ? "request" : "",
        ),
      ),
    );
  return "error" in answer || answer.status === "not-running"
    ? "unknown"
    : answer.status;
}

/**
 * Whether one of macOS's own permission prompts is on screen now, by the
 * window list: what a look macOS holds is waiting on. False in a build
 * without the module.
 */
export async function macosPromptOnScreen(): Promise<boolean> {
  const native = loadModule();
  if (!native) {
    return false;
  }
  const answer = z
    .union([
      z.object({ onScreen: z.boolean() }),
      z.object({ error: z.string() }),
    ])
    .parse(JSON.parse(await native.promptOnScreen()));
  return "onScreen" in answer && answer.onScreen;
}

let macModule: MacModule | null | undefined;

/**
 * The files on the clipboard, every one the Finder's Copy put there, by
 * path. Undefined off macOS and in a build without the module, where the
 * caller reads the clipboard another way.
 */
export async function pasteboardFiles(): Promise<string[] | undefined> {
  const native = loadModule();
  if (!native) {
    return undefined;
  }
  return z
    .object({ paths: z.array(z.string()) })
    .parse(JSON.parse(await native.pasteboardFiles())).paths;
}

/**
 * Renames `from` to `to` only if nothing is at `to`, in one step the disk
 * makes (`renamex_np` with RENAME_EXCL); fails with an error whose `code`
 * is Node's errno name (`EEXIST` for a name taken). False off macOS, in a
 * build without the module, and on a disk that has no such rename (exFAT,
 * some network shares), where the caller renames another way.
 */
export async function renameExclusive(
  from: string,
  to: string,
): Promise<boolean> {
  const native = loadModule();
  if (!native) {
    return false;
  }
  const answer = z
    .union([
      z.object({ renamed: z.literal(true) }),
      z.object({ code: z.string(), error: z.string() }),
    ])
    .parse(JSON.parse(await native.renameExclusive(from, to)));
  if ("error" in answer && answer.code === "ENOTSUP") {
    return false;
  }
  if ("error" in answer) {
    throw Object.assign(new Error(`${answer.error}: ${to}`), {
      code: answer.code,
    });
  }
  return true;
}

/**
 * Whether the disk under `folder` tells names apart by case, as the disk
 * itself says. Undefined off macOS, in a build without the module, and for
 * a disk that does not say.
 */
export async function caseSensitivity(
  folder: string,
): Promise<boolean | undefined> {
  const native = loadModule();
  if (!native) {
    return undefined;
  }
  const answer = z
    .union([
      z.object({ caseSensitive: z.boolean() }),
      z.object({ error: z.string() }),
    ])
    .parse(JSON.parse(await native.caseSensitivity(folder)));
  return "error" in answer ? undefined : answer.caseSensitive;
}

/**
 * Moves a thing to the Trash and answers where it landed, or null when the
 * system does not say. Undefined off macOS and in a build without the
 * module, where the caller trashes another way.
 */
export async function trashItem(
  at: string,
): Promise<null | string | undefined> {
  const native = loadModule();
  if (!native) {
    return undefined;
  }
  const answer = z
    .union([
      z.object({ trashed: z.string().nullable() }),
      z.object({ error: z.string() }),
    ])
    .parse(JSON.parse(await native.trashItem(at)));
  if ("error" in answer) {
    throw new Error(answer.error);
  }
  return answer.trashed;
}

function loadModule(): MacModule | null {
  if (macModule === undefined) {
    const file = bridgeFile("instrument-mac.node");
    // `as`: a native module's exports are untyped; the shape is FUNCTIONS in
    // addon.m, and every answer is parsed below before it is trusted.
    macModule = file
      ? (createRequire(import.meta.url)(file) as MacModule)
      : null;
  }
  return macModule;
}

/**
 * The identifier macOS files this app's settings under: the build's own in a
 * packaged app, the dev Electron clone's own (`com.github.Electron.…`) in a
 * development run.
 * Undefined off macOS and in a build without the module.
 */
export async function bundleIdentifier(): Promise<string | undefined> {
  const native = loadModule();
  if (!native) {
    return undefined;
  }
  return z
    .object({ bundleId: z.string().optional() })
    .parse(JSON.parse(await native.bundleIdentifier())).bundleId;
}

const NotificationStatusSchema = z.object({
  /** Whether banners show, when the user has allowed them at all. */
  alerts: z.boolean().optional(),
  status: z.enum([
    "allowed",
    "denied",
    "not-asked",
    "provisional",
    "unknown",
    "unsupported",
  ]),
});

export type NotificationStatus = z.output<typeof NotificationStatusSchema>;

/**
 * What the prompt answered in a development build that stands in for macOS
 * (`INSTRUMENT_NOTIFICATION_ANSWER`), which the status then reports.
 */
let devNotificationAnswer: "allowed" | "denied" | undefined;

/**
 * Whether a development build has put the request to macOS itself, after
 * which macOS's own status is the answer, not `INSTRUMENT_NOTIFICATION_STATUS`.
 */
let devAskedMacOS = false;

/**
 * How a development build's prompt answers in place of macOS, beside
 * `INSTRUMENT_NOTIFICATION_STATUS`: `allowed`, `denied`, or `clicked`,
 * which is allowed with the test notification clicked as soon as it shows.
 */
export function devNotificationOverride():
  | "allowed"
  | "clicked"
  | "denied"
  | undefined {
  const answer = z
    .enum(["allowed", "clicked", "denied"])
    .safeParse(process.env.INSTRUMENT_NOTIFICATION_ANSWER);
  return !app.isPackaged && answer.success ? answer.data : undefined;
}

/**
 * Where the user stands on notifications: never asked, allowed, denied.
 * `unsupported` off macOS, in a build without the module, and in a dev run
 * that is not an app bundle. A development build takes
 * `INSTRUMENT_NOTIFICATION_STATUS` in its place, so a scenario can set what
 * macOS would say, until it puts the request to macOS itself.
 */
export async function notificationStatus(): Promise<NotificationStatus> {
  const override = NotificationStatusSchema.shape.status.safeParse(
    process.env.INSTRUMENT_NOTIFICATION_STATUS,
  );
  if (!app.isPackaged && override.success && !devAskedMacOS) {
    return { status: devNotificationAnswer ?? override.data };
  }
  const native = loadModule();
  if (!native) {
    return { status: "unsupported" };
  }
  return NotificationStatusSchema.parse(
    JSON.parse(await native.notificationStatus()),
  );
}

/**
 * Asks macOS to let the app notify: the system's prompt when nobody has
 * answered it, the standing answer otherwise. A refusal macOS gives without
 * asking anyone (an unsigned build, notifications managed by a profile) is
 * an answer too, with its reason, not an error: the page that asked has
 * something to say about it.
 */
export async function requestNotifications(): Promise<{
  error?: string;
  granted: boolean;
}> {
  const devAnswer = devNotificationOverride();
  if (devAnswer !== undefined) {
    devNotificationAnswer = devAnswer === "denied" ? "denied" : "allowed";
    return { granted: devNotificationAnswer === "allowed" };
  }
  const native = loadModule();
  if (!native) {
    return { granted: false };
  }
  devAskedMacOS = true;
  const answer = z
    .union([
      z.object({ granted: z.boolean() }),
      z.object({ error: z.string() }),
    ])
    .parse(JSON.parse(await native.requestNotifications()));
  return "error" in answer ? { error: answer.error, granted: false } : answer;
}

export type DataKind = "calendars" | "contacts" | "reminders";

const DataAccessSchema = z.object({
  status: z.enum([
    "allowed",
    "denied",
    "not-asked",
    "restricted",
    "unknown",
    "unsupported",
    "write-only",
  ]),
});

export type DataAccess = z.output<typeof DataAccessSchema>;

const execFileAsync = promisify(execFile);

/**
 * Where the user stands on one kind of the Mac's data, read by the helper;
 * with `request`, the system's prompt is raised when nobody has answered it.
 */
export async function dataAccess(
  kind: DataKind,
  { request = false }: { request?: boolean } = {},
): Promise<DataAccess> {
  const helper = macHelperBinPath();
  if (helper === undefined) {
    return { status: "unsupported" };
  }
  const { stdout } = await execFileAsync(
    helper,
    ["access", kind, ...(request ? ["--request"] : [])],
    // Long enough for a person to read the prompt and answer it.
    { timeout: 5 * 60_000 },
  );
  return DataAccessSchema.parse(JSON.parse(stdout));
}

/**
 * What the Finder knows about a folder's entries beyond what `stat` says:
 * packages, hidden extensions, hidden entries and aliases. Nothing off macOS
 * or in a build without the module, which leaves the listing as `stat` has it.
 */
export async function finderEntries(folder: string): Promise<FinderEntry[]> {
  const native = loadModule();
  if (!native) {
    return [];
  }
  const answer = z
    .union([
      z.object({ entries: FinderEntrySchema.array() }),
      z.object({ error: z.string() }),
    ])
    .parse(JSON.parse(await native.finderEntries(folder)));
  if ("error" in answer) {
    throw new Error(answer.error);
  }
  return answer.entries;
}

/**
 * The icon the Finder draws for a path, as a PNG `pixels` wide: an app's own
 * icon, a document's by its type. Null off macOS, in a build without the
 * module, or when nothing is at the path.
 */
export async function fileIcon(
  filePath: string,
  pixels: number,
): Promise<Buffer | null> {
  const native = loadModule();
  if (!native) {
    return null;
  }
  const answer = z
    .union([z.object({ png: z.string() }), z.object({ error: z.string() })])
    .parse(JSON.parse(await native.fileIcon(filePath, String(pixels))));
  return "error" in answer ? null : Buffer.from(answer.png, "base64");
}

/**
 * Where a Finder alias leads, without signing in to a server or mounting a
 * volume to find out. Undefined for a path that is not an alias, an alias
 * that leads nowhere, and off macOS.
 */
export async function resolveAlias(
  filePath: string,
): Promise<string | undefined> {
  const native = loadModule();
  if (!native) {
    return undefined;
  }
  const answer = z
    .union([z.object({ path: z.string() }), z.object({ error: z.string() })])
    .parse(JSON.parse(await native.resolveAlias(filePath)));
  return "error" in answer ? undefined : answer.path;
}
