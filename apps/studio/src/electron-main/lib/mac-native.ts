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
 *   grant covers both the agent's `calendar`/`contacts` commands and the
 *   onboarding page that asks ahead of them.
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
 * The helper behind the agent's `calendar` and `contacts` commands, when this
 * build carries it and this Mac can run it: it is built for macOS 14 (Darwin
 * 23), and an older loader refuses it outright.
 */
export function macHelperBinPath(): string | undefined {
  if (Number.parseInt(os.release(), 10) < 23) {
    return undefined;
  }
  return bridgeFile("instrument-mac");
}

interface MacModule {
  fileIcon: (path: string, pixels: string) => Promise<string>;
  finderEntries: (folder: string) => Promise<string>;
  resolveAlias: (path: string) => Promise<string>;
  notificationStatus: () => Promise<string>;
  requestNotifications: () => Promise<string>;
}

let macModule: MacModule | null | undefined;

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
 * Where the user stands on notifications: never asked, allowed, denied.
 * `unsupported` off macOS, in a build without the module, and in a dev run
 * that is not an app bundle.
 */
export async function notificationStatus(): Promise<NotificationStatus> {
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
  const native = loadModule();
  if (!native) {
    return { granted: false };
  }
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
