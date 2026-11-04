import { z } from "zod";

import { type ChatId } from "../../schemas/chat-id";
import { type CapabilityContext, type Gate } from "../capabilities/define";
import { CapabilityFailure } from "../capabilities/define";
import {
  appBundleId,
  appLevel,
  appRefusal,
  type MacApp,
} from "../permissions/apps";
import { getWorkspaceConfig } from "../workspace-config";
import { runDriver } from "./driver";

type DriverContext = Pick<CapabilityContext, "chatId" | "signal">;

const NOT_SET_UP =
  "computer use isn't set up on this computer. Tell the person they can set it up in Settings › Computer Use, and stop: nothing you can run grants it.";

/**
 * What the system draws to ask the person themselves: a password, or a yes to
 * a privacy prompt. An answer the agent could give is no answer from them. By
 * bundle id on macOS, and by name or desktop id elsewhere, lowercase: GNOME
 * Shell draws Linux's password prompts itself, and consent.exe is Windows's.
 */
const SYSTEM_PROMPTS = new Set([
  "com.apple.accessibility.universalaccessauthwarn",
  "com.apple.loginwindow",
  "com.apple.securityagent",
  "com.apple.usernotificationcenter",
  "consent",
  "credentialuibroker",
  "gcr-prompter",
  "gnome-shell",
  "logonui",
  "polkit-gnome-authentication-agent-1",
]);

/** This app and its other builds, whose cards the agent must not answer. */
const OWN_BUNDLE_PREFIX = "com.finalpoint.instrument";

/** The same off macOS, where an app can go by no more than its program's name. */
const OWN_NAME = /^instrument\b/i;

const RunningAppSchema = z.object({
  bundle_id: z.string().optional(),
  name: z.string(),
  pid: z.number(),
  presentation: z.string().optional(),
});
type RunningApp = z.output<typeof RunningAppSchema>;

const AppsSchema = z.object({ apps: z.array(RunningAppSchema) });

const WindowSchema = z.object({
  accessible: z.boolean().optional(),
  id: z.string(),
  is_focused: z.boolean().optional(),
  minimized: z.boolean().optional(),
  pid: z.number(),
  title: z.string().optional(),
  visible: z.boolean().optional(),
});
export type AppWindow = z.output<typeof WindowSchema>;

/**
 * An app as a grant knows it: its bundle id on macOS, its desktop id on Linux
 * where it has one, and otherwise, as on Windows, its program's name.
 */
function identityOf(app: RunningApp): MacApp {
  return { bundleId: app.bundle_id ?? app.name, name: app.name };
}

/** The apps running now that a person would call apps, helpers left out. */
export async function runningApps(ctx: DriverContext): Promise<RunningApp[]> {
  return AppsSchema.parse(await runDriver(["list-apps"], ctx)).apps;
}

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The running app by its whole name or bundle id: a substring never matches. */
async function runningApp(
  given: string,
  ctx: DriverContext,
): Promise<RunningApp | undefined> {
  const matching = (await runningApps(ctx)).filter(
    (app) =>
      same(app.name, given) ||
      (app.bundle_id !== undefined && same(app.bundle_id, given)),
  );
  return (
    matching.find((app) => app.presentation === "foreground") ?? matching[0]
  );
}

/** Why the agent may never drive `app`, however it is asked. */
function offLimits(app: MacApp, pid?: number): string | undefined {
  const own = getWorkspaceConfig().computerUse?.ownBundleId;
  if (
    pid === process.pid ||
    app.bundleId === own ||
    app.bundleId.startsWith(OWN_BUNDLE_PREFIX) ||
    OWN_NAME.test(app.name)
  ) {
    return "this app can't drive its own windows. Its cards and settings are the person's to answer.";
  }
  if (
    SYSTEM_PROMPTS.has(app.bundleId.toLowerCase()) ||
    SYSTEM_PROMPTS.has(app.name.toLowerCase())
  ) {
    return `${app.name} is how the system asks the person themselves, so only they can answer it.`;
  }
  return undefined;
}

/** Whether `app` is one the agent may never drive, so it isn't offered. */
export function isOffLimits(app: RunningApp): boolean {
  return offLimits(identityOf(app), app.pid) !== undefined;
}

/**
 * How a card names `app`: by name when that finds it, else by its bundle id.
 * Off macOS nothing looks a name up, and the name is what a person knows.
 */
async function askableName(app: MacApp): Promise<string> {
  return process.platform !== "darwin" ||
    (await appBundleId(app.name)) === app.bundleId
    ? app.name
    : app.bundleId;
}

/**
 * Whether the agent may act on `app` in this chat: the same answer as every
 * other route to it, so a grant, a "Not now" and a rule in Settings all hold.
 */
async function gateFor(
  app: MacApp,
  ctx: CapabilityContext,
  pid?: number,
): Promise<Gate> {
  const closed = offLimits(app, pid);
  if (closed !== undefined) {
    return { kind: "refused", message: closed };
  }
  const refused = await appRefusal(ctx.chatId, app, ctx.asker);
  if (refused === undefined) {
    return { kind: "allowed" };
  }
  return (await appLevel(ctx.chatId, app)) === "never"
    ? { kind: "refused", message: refused }
    : {
        ask: { kind: "app", target: await askableName(app) },
        kind: "ask",
        message: refused,
      };
}

function setUpRefusal(): Gate | undefined {
  return getWorkspaceConfig().computerUse?.isReady() === true
    ? undefined
    : { kind: "refused", message: NOT_SET_UP };
}

/** The gate of a command that names no app, which still needs setup finished. */
export function setUpGate(): Promise<Gate> {
  return Promise.resolve(setUpRefusal() ?? { kind: "allowed" });
}

/** The gate of a command that names a running app. */
export async function runningAppGate(
  given: string,
  ctx: CapabilityContext,
): Promise<Gate> {
  const notSetUp = setUpRefusal();
  if (notSetUp !== undefined) {
    return notSetUp;
  }
  const running = await runningApp(given, ctx);
  if (running === undefined) {
    return {
      kind: "refused",
      message: `no app called ${JSON.stringify(given)} is running. \`instrument computer apps\` lists what is, and \`instrument computer open\` starts one.`,
    };
  }
  return gateFor(identityOf(running), ctx, running.pid);
}

/** The gate of `open`, whose app may not be running yet. */
export async function openableAppGate(
  given: string,
  ctx: CapabilityContext,
): Promise<Gate> {
  const notSetUp = setUpRefusal();
  if (notSetUp !== undefined) {
    return notSetUp;
  }
  const app = await openableApp(given, ctx);
  return app === undefined
    ? {
        kind: "refused",
        message: `No app called ${JSON.stringify(given)} is on this computer.`,
      }
    : gateFor(app, ctx);
}

/** An app to open: as it runs now, else as Spotlight finds it by name. */
export async function openableApp(
  given: string,
  ctx: DriverContext,
): Promise<MacApp | undefined> {
  const running = await runningApp(given, ctx);
  if (running !== undefined) {
    return identityOf(running);
  }
  // Only macOS can look an app up by name here; elsewhere the driver finds it.
  const bundleId =
    process.platform === "darwin" ? await appBundleId(given) : given;
  return bundleId === undefined ? undefined : { bundleId, name: given };
}

/** Refs each chat's snapshots gave out, by snapshot id, and whose app they are. */
const snapshotApps = new Map<ChatId, Map<string, MacApp>>();

/** Snapshots a chat keeps open at once: an older ref asks for a new snapshot. */
const MAX_SNAPSHOTS = 64;

export function rememberSnapshot(
  chatId: ChatId,
  snapshotId: string,
  app: MacApp,
): void {
  const known = snapshotApps.get(chatId) ?? new Map<string, MacApp>();
  known.delete(snapshotId);
  known.set(snapshotId, app);
  for (const oldest of known.keys()) {
    if (known.size <= MAX_SNAPSHOTS) {
      break;
    }
    known.delete(oldest);
  }
  snapshotApps.set(chatId, known);
}

/** A ref's snapshot, from `@<snapshot>:e<n>`, or nothing for another shape. */
function snapshotOfRef(ref: string): string | undefined {
  return /^@([^:\s]+):e\d+$/.exec(ref)?.[1];
}

/** The app a ref is in, as its snapshot was taken of. */
export function appOfRef(chatId: ChatId, ref: string): MacApp | undefined {
  const snapshot = snapshotOfRef(ref);
  return snapshot === undefined
    ? undefined
    : snapshotApps.get(chatId)?.get(snapshot);
}

/**
 * The gate of a command that acts on a ref: its app is the one its snapshot
 * was taken of, asked again now, since a grant can go between the two.
 */
export function refGate(ref: string, ctx: CapabilityContext): Promise<Gate> {
  const notSetUp = setUpRefusal();
  if (notSetUp !== undefined) {
    return Promise.resolve(notSetUp);
  }
  const app = appOfRef(ctx.chatId, ref);
  return app === undefined
    ? Promise.resolve({
        kind: "refused",
        message: `${ref} isn't from a snapshot this chat took. Take a new snapshot and use its refs.`,
      })
    : gateFor(app, ctx);
}

/** The running app a command names, which its gate has let through. */
export async function gatedRunningApp(
  given: string,
  ctx: DriverContext,
): Promise<MacApp & { pid: number }> {
  const running = await runningApp(given, ctx);
  if (running === undefined) {
    throw new CapabilityFailure(
      `${given} is no longer running. \`instrument computer apps\` lists what is.`,
    );
  }
  return { ...identityOf(running), pid: running.pid };
}

/** The windows of `app`, every instance of it included. */
export async function windowsOf(
  app: MacApp,
  ctx: DriverContext,
): Promise<AppWindow[]> {
  const [apps, windows] = await Promise.all([
    runningApps(ctx),
    runDriver(["list-windows", "--app", app.name], ctx),
  ]);
  const pids = new Set(
    apps
      .filter((each) => identityOf(each).bundleId === app.bundleId)
      .map((each) => each.pid),
  );
  return z
    .array(WindowSchema)
    .parse(windows)
    .filter((window) => pids.has(window.pid));
}

export function windowLine(window: AppWindow): string {
  return [
    window.id,
    JSON.stringify(window.title ?? ""),
    window.is_focused === true ? "[focused]" : undefined,
    window.minimized === true ? "[minimized]" : undefined,
    window.accessible === false ? "[can't be read: not on screen]" : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" ");
}

/**
 * The driver's words for the window a command means: the one it names, which
 * must be `app`'s, or the one the app has, or the app itself where it has none
 * (a menu bar app). Several windows and none named is the agent's to choose.
 */
export async function windowTarget(
  app: MacApp,
  named: string | undefined,
  ctx: DriverContext,
): Promise<string[]> {
  const windows = await windowsOf(app, ctx);
  if (named !== undefined) {
    if (!windows.some((window) => window.id === named)) {
      throw new CapabilityFailure(
        `${named} isn't a window of ${app.name}. \`instrument computer windows ${app.name}\` lists its windows.`,
      );
    }
    return ["--window-id", named];
  }
  const readable = windows.filter((window) => window.accessible !== false);
  if (windows.length === 0) {
    return ["--app", app.name];
  }
  const [only] = readable;
  if (only === undefined) {
    throw new CapabilityFailure(
      `${app.name} has windows, but none is on the screen where it can be read. Ask the person to bring one up:\n${windows.map(windowLine).join("\n")}`,
    );
  }
  if (readable.length > 1) {
    throw new CapabilityFailure(
      `${app.name} has ${String(readable.length)} windows. Name one with --window:\n${readable.map(windowLine).join("\n")}`,
    );
  }
  return ["--window-id", only.id];
}
