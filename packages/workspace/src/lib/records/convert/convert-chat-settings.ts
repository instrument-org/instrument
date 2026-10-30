import {
  SETTINGS_FILE_NAME,
  WORKSPACE_MACHINE_ENTRIES,
} from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";
import { parallel } from "radashi";

import { ChatIdSchema } from "../../../schemas/chat-id";
import { ChatDirSchema } from "../../../schemas/paths";
import { chatStatePath } from "../../chat-dir-utils";
import { readJsonRecord, updateJsonRecord } from "../../json-record-file";
import { ChatPermissionsSchema } from "../../permissions/rules";
import { type DeviceId } from "../device-id";
import { foldChatInFolder } from "../fold-folder";
import { openSettingsFile } from "../open-log";

/**
 * Carries what a chat's `settings.json` held to where this build keeps it,
 * at launch, before anything opens a chat. `settings.json` was the one file
 * in a chat's record folder every device rewrote whole, so two computers
 * changing a chat at once lost one change; this build writes none.
 *
 * - The model (`modelURI`) becomes a `model` setting on the chat's own
 *   session, in this device's settings file, unless a device already set one.
 * - What was allowed and refused in the chat (`grants`, `appGrants`,
 *   `denials`) goes into this computer's `permissions.json`, unless it
 *   already answers for the chat: each names something on this computer.
 * - Where this device left off (`state`, from builds before it had a file of
 *   its own) goes into `state.<device>.json`, unless that file holds
 *   something already.
 * - Then the file goes. `chatSessionId`, `createdAt`, `createdWithAppVersion`
 *   and `lastActivityAt` are read from the records now, and
 *   `reasoningEffort` was never set by anything.
 *
 * Safe to run on every launch: a value already carried writes nothing, and
 * the file is removed only once everything in it is carried. A chat still on
 * its `chat.db` keeps its file, which names its session until its records do.
 */

interface ChatSettingsConverted {
  /** One line per chat whose `settings.json` was converted, for the log. */
  done: string[];
  /** Chats whose `settings.json` could not be carried yet, each with why. */
  left: { reason: string; where: string }[];
}

/** How many chats are read at once: each is a fold of its folder. */
const CHATS_AT_ONCE = 8;

export async function convertChatSettingsFiles({
  chatsDir,
  deviceId,
  machineDir,
}: {
  /** The workspace's record folders, `.instrument/chats/`. */
  chatsDir: string;
  deviceId: DeviceId;
  /** The workspace's folder on this computer. */
  machineDir: string;
}): Promise<ChatSettingsConverted> {
  const converted: ChatSettingsConverted = { done: [], left: [] };
  let entries;
  try {
    entries = await fs.readdir(chatsDir, { withFileTypes: true });
  } catch {
    return converted;
  }
  const dirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(chatsDir, entry.name))
    .toSorted();
  const results = await parallel({ limit: CHATS_AT_ONCE }, dirs, (dir) =>
    convertChatSettings(dir, { deviceId, machineDir }),
  );
  for (const [index, result] of results.entries()) {
    const where = path.basename(dirs[index] ?? "");
    if (result.kind === "converted") {
      converted.done.push(
        result.carried.length === 0
          ? `${where}: removed ${SETTINGS_FILE_NAME}`
          : `${where}: carried ${result.carried.join(", ")}, removed ${SETTINGS_FILE_NAME}`,
      );
    } else if (result.kind === "left") {
      converted.left.push({ reason: result.reason, where });
    }
  }
  return converted;
}

type ChatSettingsConversion =
  /** Carried what it held, which may be nothing, and removed the file. */
  | { carried: string[]; kind: "converted" }
  | { kind: "left"; reason: string }
  /** No `settings.json`. */
  | { kind: "nothing" };

/** Carries one chat's `settings.json`, whose record folder is `dir`. */
export async function convertChatSettings(
  dir: string,
  { deviceId, machineDir }: { deviceId: DeviceId; machineDir: string },
): Promise<ChatSettingsConversion> {
  const read = await readJsonRecord(path.join(dir, SETTINGS_FILE_NAME));
  if (read.kind === "missing") {
    return { kind: "nothing" };
  }
  if (read.kind === "unreadable") {
    return { kind: "left", reason: `${SETTINGS_FILE_NAME} cannot be read` };
  }
  const settings = read.record;
  const chat = await foldChatInFolder(dir);
  const own = chat.sessions.find((session) => session.parent === undefined);
  if (!own) {
    // A chat still on its `chat.db`, which the database converter retries
    // at every launch: its settings wait for its records.
    return { kind: "left", reason: "it has no records of its own yet" };
  }
  const carried: string[] = [];
  const at = dateIn(settings.lastActivityAt) ?? new Date();
  if (
    typeof settings.modelURI === "string" &&
    settings.modelURI !== "" &&
    own.settings.model === undefined
  ) {
    const writer = await openSettingsFile(dir, deviceId);
    await writer.append({
      t: "set",
      at,
      session: own.id,
      field: "model",
      value: settings.modelURI,
      device: deviceId,
    });
    await writer.commit();
    carried.push("its model");
  }
  const id = ChatIdSchema.safeParse(path.basename(dir));
  if (id.success && (await carryPermissions(machineDir, id.data, settings))) {
    carried.push("what it allowed");
  }
  if (await carryState(dir, deviceId, settings.state)) {
    carried.push("where this device left off");
  }
  await fs.rm(path.join(dir, SETTINGS_FILE_NAME), { force: true });
  return { carried, kind: "converted" };
}

/**
 * Puts what the chat allowed and refused into this computer's permission
 * settings, where the rest of the folder and app rules are, unless they
 * already answer for the chat: an answer given since is what the person
 * meant last. Says whether anything was written.
 */
async function carryPermissions(
  machineDir: string,
  id: string,
  settings: Record<string, unknown>,
): Promise<boolean> {
  const permissions = ChatPermissionsSchema.parse(settings);
  if (
    permissions.appGrants.length === 0 &&
    permissions.denials.length === 0 &&
    permissions.grants.length === 0
  ) {
    return false;
  }
  let wrote = false;
  await updateJsonRecord(
    path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.permissions),
    (current) => {
      const chats = isRecord(current.chats) ? current.chats : {};
      if (chats[id] !== undefined) {
        return undefined;
      }
      wrote = true;
      return { chats: { ...chats, [id]: permissions } };
    },
  );
  return wrote;
}

/**
 * Puts the state an earlier build kept under `state` in `settings.json` into
 * this device's state file, under the names it has now, when that file holds
 * nothing yet. Says whether anything was written.
 */
async function carryState(
  dir: string,
  deviceId: DeviceId,
  state: unknown,
): Promise<boolean> {
  if (!isRecord(state)) {
    return false;
  }
  // The app guides handed are read from the chat's history, not kept, and a
  // card an earlier build kept here was this device's alone: its agent asks
  // again when it next needs what the card was for.
  const { appGuidesRead: _handed, asks: _asks, ...rest } = state;
  let wrote = false;
  await updateJsonRecord(
    chatStatePath(ChatDirSchema.parse(dir), deviceId),
    (current) => {
      if (Object.keys(current).length > 0) {
        return undefined;
      }
      wrote = true;
      return rest;
    },
  );
  return wrote;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dateIn(value: unknown): Date | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
