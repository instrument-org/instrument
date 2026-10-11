import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { type ChatGrant } from "../../schemas/chat-settings";
import { AbsolutePathSchema } from "../../schemas/paths";
import { hostPathWithin } from "../host-path";
import { readJsonRecord, updateJsonRecord } from "../json-record-file";
import { getWorkspaceConfig } from "../workspace-config";
import {
  type Level,
  LevelSchema,
  PLACE_DEFAULTS,
  type PlaceId,
  PlaceIdSchema,
  placePaths,
} from "./places";

/**
 * Settings › Permissions as written: a rule per place the person changed, a
 * rule per folder they or an "Always allow" added, and the switch that turns
 * every Ask first into a yes. A place nobody changed keeps its default.
 */
export const PermissionSettingsSchema = z.object({
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
export function permissionsFile(): string {
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

/** One rule at one path, and where it came from. */
export interface Rule {
  /** Every hidden entry directly in `path`, rather than `path` itself. */
  dotEntries?: true;
  level: Level;
  path: string;
  /** Present for a built-in place's rule. */
  place?: PlaceId;
  /** Ranks rules at the same path: a chat's grant over a folder rule over a place. */
  source: "folder" | "grant" | "place";
}

/** Everything that decides one chat's reach, resolved once and checked often. */
export interface Rules {
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
  extraAllows = [],
  grants = [],
  home = os.homedir(),
  settings,
}: {
  extraAllows?: readonly string[];
  grants?: readonly ChatGrant[];
  home?: string;
  settings: PermissionSettings;
}): Rules {
  const rules: Rule[] = [];
  for (const place of placePaths(home)) {
    const level =
      place.id === "output"
        ? PLACE_DEFAULTS.output
        : (settings.places[place.id] ?? PLACE_DEFAULTS[place.id]);
    for (const placePath of place.paths) {
      rules.push({ level, path: placePath, place: place.id, source: "place" });
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
  return { home, rules, withoutAsking: settings.withoutAsking };
}

/** What the rules make of one path. */
export interface Reach {
  level: Level;
  /** The rule that decided, absent where nothing but the defaults did. */
  rule?: Rule;
}

const SOURCE_RANK = { folder: 1, grant: 2, place: 0 } as const;

/**
 * Whether the agent may read or change `hostPath`. The deepest rule holding
 * the path decides, so a folder allowed inside a place that asks is allowed,
 * and a folder closed inside it stays closed. Where no rule holds the path,
 * reading is allowed so the agent can find what it needs, and changing
 * anything asks.
 *
 * "Use folders without asking" turns every ask into an allow. Nothing turns a
 * never into anything else.
 */
export function reachOf(
  rules: Rules,
  hostPath: string,
  op: "read" | "write",
): Reach {
  let best: undefined | { depth: number; rule: Rule };
  for (const rule of rules.rules) {
    const depth = holdingDepth(rule, hostPath);
    if (depth === null) {
      continue;
    }
    if (
      !best ||
      depth > best.depth ||
      (depth === best.depth &&
        SOURCE_RANK[rule.source] > SOURCE_RANK[best.rule.source])
    ) {
      best = { depth, rule };
    }
  }
  const level = best ? best.rule.level : op === "read" ? "allow" : "ask";
  return {
    level: level === "ask" && rules.withoutAsking ? "allow" : level,
    rule: best?.rule,
  };
}

/** How deep the rule's path is, if it holds `hostPath`. */
function holdingDepth(rule: Rule, hostPath: string): null | number {
  const within = hostPathWithin(rule.path, hostPath);
  if (within === null) {
    return null;
  }
  const depth = segments(rule.path);
  if (!rule.dotEntries) {
    return depth;
  }
  const first = within.split("/")[1];
  return first?.startsWith(".") ? depth + 1 : null;
}

function segments(hostPath: string): number {
  return path.resolve(hostPath).split(path.sep).filter(Boolean).length;
}

/**
 * The folder to ask for when the agent needs `hostPath`: one level below the
 * place or folder rule that asks, so the person sees a name they made rather
 * than the whole of Documents or a folder five levels down. The rule's own
 * folder when the path is that folder or a file directly in it.
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
