import { APP_BUNDLE_ID } from "@instrument-org/shared";
import { app, shell } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
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
  "../../native/mac-helper/.build/out/Products/Release",
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

/** The helper behind the agent's `calendar` and `contacts` commands, when this build carries it. */
export function macHelperBinPath(): string | undefined {
  return bridgeFile("instrument-mac");
}

interface MacModule {
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
 * answered it, the standing answer otherwise.
 */
export async function requestNotifications(): Promise<{ granted: boolean }> {
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
  if ("error" in answer) {
    throw new Error(answer.error);
  }
  return answer;
}

/**
 * System Settings at Instrument's own row under Notifications, where a
 * "no" is changed. The `id` is undocumented; without it the pane still
 * opens, one scroll from the row.
 */
export async function openNotificationSettings(): Promise<void> {
  await shell.openExternal(
    `x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=${APP_BUNDLE_ID}`,
  );
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
