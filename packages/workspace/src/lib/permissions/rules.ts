import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { type ChatGrant } from "../../schemas/chat-settings";
import { AbsolutePathSchema } from "../../schemas/paths";
import { hostPathWithin } from "../host-path";
import { readJsonRecord, updateJsonRecord } from "../json-record-file";
import { type Asker } from "./asks";
import { getWorkspaceConfig } from "../workspace-config";
import {
  type Level,
  LevelSchema,
  PLACE_DEFAULTS,
  DANGEROUS_NAMES,
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
  withoutAsking: z.boolean().catch(false).default(false),
});
export type PermissionSettings = z.output<typeof PermissionSettingsSchema>;

/** Where the workspace keeps Settings › Permissions. */
function permissionsFile(): string {
  return path.join(getWorkspaceConfig().rootDir, "permissions.json");
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
 * What a rule makes of its folder: a person's level, or one of the two the
 * app sets for its own folders. "hidden" is its internals, which the agent
 * meets as missing; "readOnly" is what it may read and never change, such
 * as the skills the app ships.
 */
export type Access = "hidden" | "readOnly" | Level;

/** One rule at one path, and where it came from. */
export interface Rule {
  /** Every hidden entry directly in `path`, rather than `path` itself. */
  dotEntries?: true;
  level: Access;
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
   * The session these rules hold, which a refusal that asks first raises
   * its card for. Absent, a refusal says what is needed and raises nothing.
   */
  asker?: Asker;
  home: string;
  rules: Rule[];
  withoutAsking: boolean;
}

/**
 * The rules for a chat: the places with the person's changes, their folder
 * rules, and the chat's grants, which are allows. `extraAllows` are folders
 * the chat holds without a grant (its own folder, its topics' folders).
 */
export function rulesFor({
  denials = [],
  extraAllows = [],
  grants = [],
  home = os.homedir(),
  settings,
}: {
  /** Folders the person said not now to in this chat. */
  denials?: readonly string[];
  extraAllows?: readonly string[];
  grants?: readonly ChatGrant[];
  home?: string;
  settings: PermissionSettings;
}): Rules {
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
    for (const placePath of place.paths) {
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
    if (place.homeDotEntries) {
      rules.push({
        dotEntries: true,
        level,
        path: home,
        place: place.id,
        source: "place",
      });
    }
  }
  for (const folder of settings.folders) {
    rules.push({ level: folder.level, path: folder.path, source: "folder" });
  }
  for (const allowed of [
    ...grants.map((grant) => grant.path),
    ...extraAllows,
  ]) {
    rules.push({ level: "allow", path: allowed, source: "grant" });
  }
  // An Always allow for the folder or one holding it, given in Settings or
  // from any chat's card, outranks a chat's earlier "Not now".
  const alwaysAllowed = settings.folders
    .filter((folder) => folder.level === "allow")
    .map((folder) => folder.path);
  for (const denied of denials) {
    if (
      alwaysAllowed.some((allowed) => hostPathWithin(allowed, denied) !== null)
    ) {
      continue;
    }
    rules.push({ denied: true, level: "never", path: denied, source: "grant" });
  }
  return { home, rules, withoutAsking: settings.withoutAsking };
}

/** What the rules make of one path. */
export interface Reach {
  level: "allow" | "ask" | "hidden" | "never";
  /** The rule that decided, absent where nothing but the defaults did. */
  rule?: Rule;
}

export const SOURCE_RANK = {
  folder: 1,
  grant: 2,
  place: 0,
  system: 3,
} as const;

/**
 * A rule's level with "Use folders without asking" applied: every Ask first
 * becomes a yes but the passwords place's, which holds sign-ins rather than
 * work and keeps asking.
 */
export function levelWithoutAsking<L extends Access>(
  level: L,
  rule: Rule | undefined,
  withoutAsking: boolean,
): "allow" | L {
  return level === "ask" && withoutAsking && rule?.place !== "passwords"
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
 * passwords place's. Nothing turns a never into anything else.
 */
export function reachOf(
  rules: Rules,
  hostPath: string,
  op: "read" | "write",
): Reach {
  const target = fold(path.resolve(hostPath));
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
      (held === best.depth &&
        SOURCE_RANK[rule.source] > SOURCE_RANK[best.rule.source])
    ) {
      best = { depth: held, rule };
    }
  }
  // A name that runs code when its folder is used is closed to changes
  // anywhere but the app's own folders.
  if (
    op === "write" &&
    !(best?.rule.source === "system" && best.rule.level === "allow") &&
    namesDangerous(target)
  ) {
    return { level: "never", rule: best?.rule };
  }
  const access = best ? best.rule.level : op === "read" ? "allow" : "ask";
  const level =
    access === "readOnly" ? (op === "read" ? "allow" : "never") : access;
  return {
    level: levelWithoutAsking(level, best?.rule, rules.withoutAsking),
    rule: best?.rule,
  };
}

function namesDangerous(foldedPath: string): boolean {
  const slashed = foldedPath.replaceAll(path.sep, "/");
  return DANGEROUS_NAMES.some((name) => {
    const folded = fold(name);
    return slashed.endsWith(`/${folded}`) || slashed.includes(`/${folded}/`);
  });
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
    known = rules.rules.map((rule) => {
      const root = fold(path.resolve(rule.path));
      return {
        depth: root.split(path.sep).filter(Boolean).length,
        prefix: root.endsWith(path.sep) ? root : `${root}${path.sep}`,
        root,
        rule,
      };
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
 * for a sign-in folder, which is answered for whole.
 */
export function folderToAskFor({
  home,
  hostPath,
  isDirectory,
  rule,
}: {
  home: string;
  hostPath: string;
  isDirectory: boolean;
  rule: Rule | undefined;
}): string {
  if (rule?.place === "passwords") {
    return rule.path;
  }
  const root = rule && !rule.dotEntries ? rule.path : home;
  const within = hostPathWithin(root, hostPath);
  if (within === null) {
    return isDirectory ? hostPath : path.dirname(hostPath);
  }
  const parts = within.split("/").filter(Boolean);
  if (parts.length === 0 || (parts.length === 1 && !isDirectory)) {
    return root;
  }
  return path.join(root, parts[0] ?? "");
}
