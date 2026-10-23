import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { recordChanged } from "../record-changes";
import {
  hostPathWithin,
  namesStream,
  realHostPath,
  windowsOpenedPath,
  withoutDataVolume,
  withoutShellEscapes,
  withoutTrailingDots,
} from "../host-path";
import { readJsonRecord, updateJsonRecord } from "../json-record-file";
import { type Asker } from "../chat/asks";
import { workspaceMachineDir } from "../workspace-machine-dir";
import {
  appFolderParents,
  type Level,
  LevelSchema,
  PLACE_DEFAULTS,
  type PlaceId,
  PlaceIdSchema,
  placePaths,
  startupPaths,
} from "./places";

/**
 * Settings › Permissions as written: a rule per place the person changed, a
 * rule per folder they or an "Always allow" added, and the switch that turns
 * every Ask first into a yes. A place nobody changed keeps its default.
 */

/**
 * A folder or a file the person opened to one chat. `kind: "file"` is a file
 * sent with a message, opened alone: the rules allow it, and nothing mounts
 * it.
 */
const ChatGrantSchema = z.object({
  grantedAt: z.coerce.date(),
  kind: z.literal("file").optional(),
  path: AbsolutePathSchema,
  source: z.enum(["attached", "card"]),
});

/** A Mac app the agent may control in one chat, by the name a script tells it by. */
const ChatAppGrantSchema = z.object({
  app: z.string().min(1),
  /** Its bundle id where it could be found, so a route that knows the app by its id meets the same grant. */
  bundleId: z.string().optional(),
  grantedAt: z.coerce.date(),
});

/** A folder or an app the person said not now to in one chat. */
const ChatDenialSchema = z.object({
  deniedAt: z.coerce.date(),
  kind: z.enum(["app", "folder"]),
  target: z.string().min(1),
});

export const ChatPermissionsSchema = z.object({
  appGrants: z.array(ChatAppGrantSchema).catch([]).default([]),
  denials: z.array(ChatDenialSchema).catch([]).default([]),
  grants: z.array(ChatGrantSchema).catch([]).default([]),
});

export type ChatPermissions = z.output<typeof ChatPermissionsSchema>;
export type ChatGrant = z.output<typeof ChatGrantSchema>;
export type ChatAppGrant = z.output<typeof ChatAppGrantSchema>;
export type ChatDenial = z.output<typeof ChatDenialSchema>;

/**
 * What the person granted under one topic: folders every chat filed under it
 * reaches, each by its path on this computer.
 */
const TopicPermissionsSchema = z.object({
  folders: z
    .array(z.object({ addedAt: z.coerce.date(), path: AbsolutePathSchema }))
    .catch([])
    .default([]),
});

const PermissionSettingsSchema = z.object({
  /**
   * Apps on this computer, by the name a script tells them by, that the
   * agent may control in every chat, asks first about, or never controls.
   */
  apps: z
    .array(
      z.object({
        addedAt: z.coerce.date(),
        bundleId: z.string().optional(),
        level: LevelSchema,
        name: z.string().min(1),
      }),
    )
    .catch([])
    .default([]),
  folders: z
    .array(
      z.object({
        addedAt: z.coerce.date(),
        level: LevelSchema,
        path: AbsolutePathSchema,
      }),
    )
    .catch([])
    .default([]),
  places: z
    .partialRecord(PlaceIdSchema.exclude(["output"]), LevelSchema)
    .catch({})
    .default({}),
  /**
   * What the person allowed inside one chat, by its id: a folder or a file
   * from a card, and the Mac apps allowed there, with what they said not now
   * to. Kept here rather than in the chat, because every one of them names
   * something on this computer. The chat's own folder travels with the
   * workspace, and a path written on a Mac resolves to a different folder of
   * the same name on Windows, which opened it without anyone being asked.
   *
   * One chat that will not parse costs that chat its grants rather than
   * everyone's.
   */
  chats: z
    .record(
      z.string(),
      ChatPermissionsSchema.catch(() => ({
        appGrants: [],
        denials: [],
        grants: [],
      })),
    )
    .catch({})
    .default({}),
  /**
   * The folders granted under each topic, by its id. Here rather than in the
   * topic's `TOPIC.md`, which the workspace carries to the person's other
   * computers and which the agent can write where the workspace is the
   * person's own folder: a grant written there would open the same-named
   * path on another computer, and an edit to the file would widen what every
   * chat under the topic reaches without anyone being asked.
   */
  topics: z
    .record(
      z.string(),
      TopicPermissionsSchema.catch(() => ({ folders: [] })),
    )
    .catch({})
    .default({}),
  /**
   * "Use folders without asking", under the name it deserves on disk: every
   * folder rule that would ask says yes instead. The passwords place still
   * asks, and a path no rule holds still asks before a change, so the name
   * claims more than the switch does, which is the right way round for a
   * line someone reads while deciding whether to turn it on.
   */
  dangerouslyAllowEveryFolder: z.boolean().catch(false).default(false),
});
export type PermissionSettings = z.output<typeof PermissionSettingsSchema>;

/**
 * Where Settings › Permissions is kept: on this computer's side of the
 * workspace, since its folder rules name this computer's paths.
 */
function permissionsFile(): string {
  return permissionsFileIn(workspaceMachineDir());
}

/** The same file for a machine folder named outright, for the launch's steps. */
export function permissionsFileIn(machineDir: string): string {
  return path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.permissions);
}

/** Settings › Permissions from a record, for the launch steps that read the file themselves. */
export function permissionSettingsOf(record: unknown): PermissionSettings {
  return PermissionSettingsSchema.parse(record);
}

export async function readPermissionSettings(): Promise<PermissionSettings> {
  const read = await readJsonRecord(permissionsFile());
  return PermissionSettingsSchema.parse(
    read.kind === "read" ? read.record : {},
  );
}

export async function updatePermissionSettings(
  change: (settings: PermissionSettings) => PermissionSettings,
): Promise<PermissionSettings> {
  const written = await updateJsonRecord(permissionsFile(), (record) =>
    change(PermissionSettingsSchema.parse(record)),
  );
  return PermissionSettingsSchema.parse(written);
}

/**
 * Every rule as a new install has it: the places at their defaults, none of
 * the person's own folders or apps, asking switched back on, and nothing
 * allowed or refused in any chat or granted under any topic, so each chat
 * asks again.
 */
export async function resetPermissionSettings(): Promise<PermissionSettings> {
  let chats: string[] = [];
  const reset = await updatePermissionSettings((settings) => {
    chats = Object.keys(settings.chats);
    return PermissionSettingsSchema.parse({});
  });
  for (const chatId of chats) {
    const chat = ChatIdSchema.safeParse(chatId);
    if (chat.success) {
      recordChanged(chat.data, "settings");
    }
  }
  return reset;
}

/** What one chat holds, or nothing held yet. */
export async function readChatPermissions(
  chatId: string,
): Promise<ChatPermissions> {
  const settings = await readPermissionSettings();
  return settings.chats[chatId] ?? EMPTY_CHAT_PERMISSIONS;
}

/**
 * Changes what one chat holds. A chat with nothing left in it is taken out
 * rather than left as an empty object, so the file does not grow a row per
 * chat that was only ever asked about.
 */
export async function updateChatPermissions(
  chatId: string,
  change: (held: ChatPermissions) => ChatPermissions,
): Promise<ChatPermissions> {
  let next = EMPTY_CHAT_PERMISSIONS;
  await updatePermissionSettings((settings) => {
    next = change(settings.chats[chatId] ?? EMPTY_CHAT_PERMISSIONS);
    const empty =
      next.appGrants.length === 0 &&
      next.denials.length === 0 &&
      next.grants.length === 0;
    const { [chatId]: _taken, ...rest } = settings.chats;
    return { ...settings, chats: empty ? rest : { ...rest, [chatId]: next } };
  });
  // Said as a change to the chat's settings, which is what these were until
  // they moved here: everything watching a chat's folders, its apps or its
  // open cards wakes on that and needs to know nothing about where they are
  // kept.
  const chat = ChatIdSchema.safeParse(chatId);
  if (chat.success) {
    recordChanged(chat.data, "settings");
  }
  return next;
}

/** Forgets everything one chat held, for a chat that has been deleted. */
export async function forgetChatPermissions(chatId: string): Promise<void> {
  await updateChatPermissions(chatId, () => EMPTY_CHAT_PERMISSIONS);
}

const EMPTY_CHAT_PERMISSIONS: ChatPermissions = {
  appGrants: [],
  denials: [],
  grants: [],
};

/**
 * What a rule makes of its folder: a person's level, or "readOnly", which
 * the app sets for its own folders the agent may read and never change,
 * such as the skills it ships.
 */
export type Access = "readOnly" | Level;

/** One rule at one path, and where it came from. */
export interface Rule {
  /**
   * Set for the app's own data (this computer's folder, the workspace's
   * records), closed to every command whatever the person's rules say: no
   * card asks for it, and only the app's own rules open anything in it.
   */
  appData?: true;
  /** Every hidden entry directly in `path`, rather than `path` itself. */
  dotEntries?: true;
  /** Set for a file the user sent, which the rule opens alone. */
  file?: true;
  level: Access;
  /**
   * Set for a place that asks first whose names, sizes and dates programs
   * and the shell see without a card (App files on macOS and Windows):
   * listing a folder in it is allowed, and opening or changing a file asks.
   */
  listed?: true;
  path: string;
  /** Set for a folder the person said not now to in this chat. */
  denied?: true;
  /** Present for a built-in place's rule. */
  place?: PlaceId;
  /**
   * Ranks rules at the same path: the app's own over a chat's grant over a
   * folder rule over a place.
   */
  source: "folder" | "grant" | "place" | "system";
}

/** Everything that decides one chat's reach, resolved once and checked often. */
export interface Rules {
  /**
   * The session these rules hold, which a refusal that asks first tells
   * what to ask for. Absent, a refusal says only what is needed.
   */
  asker?: Asker;
  home: string;
  rules: Rule[];
  dangerouslyAllowEveryFolder: boolean;
}

/**
 * The rules for a chat: the places with the person's changes, their folder
 * rules, and the chat's grants, which are allows. `extraAllows` are folders
 * the chat holds without a grant (its own folder, its topic's folders).
 */
export function rulesFor({
  denials = [],
  extraAllows = [],
  extraReadOnly = [],
  grants = [],
  home = os.homedir(),
  settings,
}: {
  /** Folders the person said not now to in this chat. */
  denials?: readonly string[];
  extraAllows?: readonly string[];
  /**
   * Folders the chat reads without a grant and never changes: the skill
   * sources its shell mounts read-only. The app's own are hidden folders in
   * the home folder, which the app-files place holds and asks about, so
   * without these a loaded skill is a question the person has to answer
   * about the app's own files.
   */
  extraReadOnly?: readonly string[];
  grants?: readonly ChatGrant[];
  home?: string;
  settings: PermissionSettings;
}): Rules {
  const rules: Rule[] = [];
  // A program that looks its home up in the user database (ssh does) finds
  // the account's, which is not `home` when HOME points elsewhere, as it
  // does in a test run. That home gets the same places, and is read-only.
  const accountHome = os.userInfo().homedir;
  const homes =
    accountHome && accountHome !== home ? [home, accountHome] : [home];
  if (homes.length > 1) {
    rules.push({ level: "readOnly", path: accountHome, source: "system" });
  }
  for (const each of homes) {
    rules.push(...placeRules(each, settings));
  }
  for (const folder of settings.folders) {
    rules.push({ level: folder.level, path: folder.path, source: "folder" });
  }
  for (const grant of grants) {
    rules.push({
      ...(grant.kind === "file" && { file: true }),
      level: "allow",
      path: grant.path,
      source: "grant",
    });
  }
  for (const allowed of extraAllows) {
    rules.push({ level: "allow", path: allowed, source: "grant" });
  }
  for (const readable of extraReadOnly) {
    rules.push({ level: "readOnly", path: readable, source: "system" });
  }
  // An Always allow for the folder or one holding it, given in Settings or
  // from any chat's card, outranks a chat's earlier "Not now". A card's
  // Always on a place that is one folder (Documents) sets the place.
  const alwaysAllowed = rules.filter(
    (rule) =>
      rule.level === "allow" &&
      (rule.source === "folder" || rule.source === "place"),
  );
  for (const denied of denials) {
    if (alwaysAllowed.some((allowed) => ruleHolds(allowed, denied))) {
      continue;
    }
    rules.push({ denied: true, level: "never", path: denied, source: "grant" });
  }
  return {
    home,
    rules,
    dangerouslyAllowEveryFolder: settings.dangerouslyAllowEveryFolder,
  };
}

/**
 * Whether `rule` holds `hostPath`: the path is its folder or in it, or for
 * a rule standing for every hidden entry, one of those entries or in one.
 */
function ruleHolds(rule: Rule, hostPath: string): boolean {
  const within = hostPathWithin(rule.path, hostPath);
  if (within === null) {
    return false;
  }
  return !rule.dotEntries || within.startsWith("/.");
}

/** The startup places and built-in places in one home folder. */
function placeRules(home: string, settings: PermissionSettings): Rule[] {
  const rules: Rule[] = startupPaths(home).map((startup) => ({
    level: "never",
    path: startup,
    source: "system",
  }));
  for (const place of placePaths(home)) {
    const level =
      place.id === "output"
        ? PLACE_DEFAULTS.output
        : (settings.places[place.id] ?? PLACE_DEFAULTS[place.id]);
    const listed = place.listed && level === "ask";
    for (const placePath of place.paths) {
      rules.push({
        level,
        ...(listed && { listed: true }),
        path: placePath,
        place: place.id,
        source: "place",
      });
    }
    // Asking as the place does, without the listing.
    for (const placePath of listed ? (place.unlisted ?? []) : []) {
      rules.push({ level, path: placePath, place: place.id, source: "place" });
    }
    for (const placePath of place.closedUnlessAllowed ?? []) {
      rules.push({
        level: level === "allow" ? "allow" : "never",
        path: placePath,
        place: place.id,
        source: "place",
      });
    }
    for (const placePath of place.openUnlessClosed ?? []) {
      rules.push({
        level: level === "never" ? "never" : "allow",
        path: placePath,
        place: place.id,
        source: "place",
      });
    }
  }
  return rules;
}

/** What the rules make of one path. */
export interface Reach {
  level: "allow" | "ask" | "never";
  /** The rule that decided, absent where nothing but the defaults did. */
  rule?: Rule;
  /** Set for a path through an NTFS stream, which no rule opens. */
  stream?: true;
}

const SOURCE_RANK = {
  folder: 1,
  grant: 2,
  place: 0,
  system: 3,
} as const;

/**
 * A rule's rank among the rules holding a path at the same depth: the app's
 * own over a chat's grant over a folder rule over a place. A rule for every
 * hidden entry in a folder stands for each of them only as a fallback, so a
 * rule naming one of them at that depth (~/.ssh in the passwords place
 * against the hidden entries of other apps' files) outranks it. The rule
 * closing the app's own data outranks every other, such as the temp
 * folder's own by its real path, which lands at the same depth when that
 * data sits in a temp folder (`/var/folders/...` is `/private/var/folders/...`
 * on a Mac). `reachOf` and both native profiles order rules by it.
 */
export function ruleRank(rule: Rule): number {
  return (
    SOURCE_RANK[rule.source] -
    (rule.dotEntries ? 0.5 : 0) +
    (rule.appData ? 0.5 : 0)
  );
}

/**
 * A rule's level with "Use folders without asking" applied: every Ask first
 * becomes a yes but the passwords place's, which holds sign-ins rather than
 * work and keeps asking. A change where no rule holds the path still asks:
 * the switch is for the person's folders, and the native profiles keep
 * such a path closed to changes whatever it says.
 */
export function levelAllowingEveryFolder<L extends Access>(
  level: L,
  rule: Rule | undefined,
  dangerouslyAllowEveryFolder: boolean,
): "allow" | L {
  return level === "ask" &&
    dangerouslyAllowEveryFolder &&
    rule !== undefined &&
    rule.place !== "passwords"
    ? "allow"
    : level;
}

/**
 * Whether the agent may read or change `hostPath`. The deepest rule holding
 * the path decides, so a folder allowed inside a place that asks is allowed,
 * and a folder closed inside it stays closed. Where no rule holds the path,
 * reading is allowed so the agent can find what it needs, and changing
 * anything asks.
 *
 * "Use folders without asking" turns an ask into an allow, but for the
 * passwords place's. Nothing turns a never into anything else. A path on
 * macOS's Data volume meets the rules as the rest of the system spells it.
 * On Windows a path meets them as the system opens it, its short names
 * read as the long ones and a name ending in dots or spaces as the name
 * without them, and a path through an NTFS stream, which is a second name
 * for a file or folder, is closed. A spelling of the app's own data with a
 * shell's escapes left in is the app's own data too, closed rather than
 * asked for.
 */
export function reachOf(
  rules: Rules,
  hostPath: string,
  /** `list` is reading a folder's names, which a listed place allows. */
  op: "list" | "read" | "write",
): Reach {
  if (namesStream(hostPath)) {
    return { level: "never", stream: true };
  }
  const unescaped = withoutShellEscapes(hostPath);
  const appData =
    unescaped === hostPath ? undefined : appDataHolding(rules, unescaped);
  if (appData) {
    return { level: "never", rule: appData };
  }
  const resolved = withoutTrailingDots(
    withoutDataVolume(windowsOpenedPath(path.resolve(hostPath))),
  );
  const target = fold(resolved);
  let best: undefined | { depth: number; rule: Rule };
  for (const { depth, prefix, root, rule } of compiled(rules)) {
    let held: number | undefined;
    if (rule.dotEntries) {
      // The rule's folder's hidden entries, one level in: `<root>/.x...`.
      if (target.startsWith(`${prefix}.`)) {
        held = depth + 1;
      }
    } else if (target === root || target.startsWith(prefix)) {
      held = depth;
    }
    if (held === undefined) {
      continue;
    }
    if (
      !best ||
      held > best.depth ||
      (held === best.depth && ruleRank(rule) > ruleRank(best.rule))
    ) {
      best = { depth: held, rule };
    }
  }
  // An allow on a folder that holds the home folder (a temp folder holding
  // a test's planted home) opens nothing in the home to change, as the
  // native profiles close the home to changes beneath every rule above it;
  // the home's own default, asking, holds there.
  if (
    op === "write" &&
    best?.rule.level === "allow" &&
    best.depth < homeDepth(rules) &&
    hostPathWithin(rules.home, resolved) !== null
  ) {
    best = undefined;
  }
  const access = !best
    ? op === "write"
      ? "ask"
      : "allow"
    : op === "list" && best.rule.listed && best.rule.level === "ask"
      ? "allow"
      : best.rule.level;
  const level =
    access === "readOnly" ? (op === "write" ? "never" : "allow") : access;
  return {
    level: levelAllowingEveryFolder(
      level,
      best?.rule,
      rules.dangerouslyAllowEveryFolder,
    ),
    rule: best?.rule,
  };
}

/** The rule closing the app's own data that holds `hostPath`, if one does. */
function appDataHolding(rules: Rules, hostPath: string): Rule | undefined {
  const target = fold(
    withoutTrailingDots(withoutDataVolume(path.resolve(hostPath))),
  );
  return compiled(rules).find(
    ({ prefix, root, rule }) =>
      rule.appData && (target === root || target.startsWith(prefix)),
  )?.rule;
}

function homeDepth(rules: Rules): number {
  return path.resolve(rules.home).split(path.sep).filter(Boolean).length;
}

/**
 * Disks that ignore case: the default on macOS and Windows, where
 * `~/documents` opens `~/Documents` and a rule has to hold both.
 */
const CASE_INSENSITIVE =
  process.platform === "darwin" || process.platform === "win32";

function fold(value: string): string {
  return CASE_INSENSITIVE ? value.toLowerCase() : value;
}

/**
 * The rules as plain string prefixes, made once per set: a shell asks of
 * every entry a walk passes, tens of thousands of times a call.
 */
const compiledRules = new WeakMap<
  Rules,
  { depth: number; prefix: string; root: string; rule: Rule }[]
>();

function compiled(rules: Rules) {
  let known = compiledRules.get(rules);
  if (!known) {
    // A rule holds its folder by the path it names and by where that path
    // really is: a path read through a link (`/tmp` on macOS is
    // `/private/tmp`) meets the same rule either way. Each at its own depth,
    // so a rule named deep through a link that leads somewhere shallow (into
    // or above the app's own data) holds what it leads to only as deep as it
    // really is, and a deeper rule there still decides.
    known = rules.rules.flatMap((rule) => {
      const spelled = withoutTrailingDots(
        withoutDataVolume(path.resolve(rule.path)),
      );
      return [
        ...new Set([
          fold(spelled),
          fold(realHostPath(spelled)),
          fold(windowsOpenedPath(spelled)),
        ]),
      ].map((root) => ({
        depth: root.split(path.sep).filter(Boolean).length,
        prefix: root.endsWith(path.sep) ? root : `${root}${path.sep}`,
        root,
        rule,
      }));
    });
    compiledRules.set(rules, known);
  }
  return known;
}

/**
 * The folder to ask for when the agent needs `hostPath`: one level below the
 * place or folder rule that asks, so the person sees a name they made rather
 * than the whole of Documents or a folder five levels down. The rule's own
 * folder when the path is that folder or a file directly in it, and always
 * for a sign-in folder, which is answered for whole. A folder holding the
 * app's own data gives way to the one below it on the way to the path
 * (`~/Library/Application Support/Other App` rather than Application
 * Support), so a card never names it; one with nothing below it is left as
 * it is, for `ruleRefusal` to name nothing to ask for. In the app-files place a
 * folder holding a folder per app gives way the same way, so the card names
 * one app's folder (`AppData\Roaming\Discord`).
 */
export function folderToAskFor({
  hostPath,
  isDirectory,
  rule,
  rules,
}: {
  hostPath: string;
  isDirectory: boolean;
  rule: Rule | undefined;
  rules: Rules;
}): string {
  if (rule?.place === "passwords") {
    return rule.path;
  }
  // A rule over a folder holding the home folder (the drive it is on, a
  // folder rule on `/Users`) asks from the home folder down for a path in
  // it, as no rule would: one level below that rule is the home folder or a
  // folder holding it, which is never the thing to ask for.
  const ruleRoot = rule && !rule.dotEntries ? rule.path : undefined;
  const root =
    ruleRoot === undefined ||
    (hostPathWithin(ruleRoot, rules.home) !== null &&
      hostPathWithin(rules.home, hostPath) !== null)
      ? rules.home
      : ruleRoot;
  const within = hostPathWithin(root, hostPath);
  if (within === null) {
    return isDirectory ? hostPath : path.dirname(hostPath);
  }
  const parts = within.split("/").filter(Boolean);
  // The folders the path is in, below the rule's own: all of it for a
  // folder, all but the file's name for a file.
  const folders = isDirectory ? parts : parts.slice(0, -1);
  let depth = folders.length === 0 ? 0 : 1;
  const parents =
    rule?.place === "appFiles" ? appFolderParents(rules.home) : [];
  const passedOver = (folder: string) =>
    holdsAppData(rules, folder) ||
    parents.some((parent) => hostPathWithin(parent, folder) === "/");
  while (
    depth < folders.length &&
    passedOver(path.join(root, ...folders.slice(0, depth)))
  ) {
    depth++;
  }
  return path.join(root, ...folders.slice(0, depth));
}

/**
 * Whether `folder` is or holds any of the app's own data, which a yes to it
 * would seem to open, spelled as it is or with a shell's escapes taken out.
 */
export function holdsAppData(rules: Rules, folder: string): boolean {
  const spellings = new Set([folder, withoutShellEscapes(folder)]);
  return rules.rules.some(
    (rule) =>
      rule.appData &&
      [...spellings].some(
        (spelling) => hostPathWithin(spelling, rule.path) !== null,
      ),
  );
}
