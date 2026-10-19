import { SETTINGS_FILE_NAME } from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";
import { parallel } from "radashi";

import { readJsonRecord } from "../../json-record-file";
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
 *
 * Safe to run on every launch: a value already carried writes nothing.
 */

export interface ChatSettingsConverted {
  /** One line per chat something was carried for, for the log. */
  done: string[];
  /** Chats whose `settings.json` could not be carried yet, each with why. */
  left: { reason: string; where: string }[];
}

/** How many chats are read at once: each is a fold of its folder. */
const CHATS_AT_ONCE = 8;

export async function convertChatSettingsFiles({
  chatsDir,
  deviceId,
}: {
  /** The workspace's record folders, `.instrument/chats/`. */
  chatsDir: string;
  deviceId: DeviceId;
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
    convertChatSettings(dir, deviceId),
  );
  for (const [index, result] of results.entries()) {
    const where = path.basename(dirs[index] ?? "");
    if (result.kind === "carried") {
      converted.done.push(`${where}: carried ${result.carried.join(", ")}`);
    } else if (result.kind === "left") {
      converted.left.push({ reason: result.reason, where });
    }
  }
  return converted;
}

type ChatSettingsConversion =
  | { carried: string[]; kind: "carried" }
  | { kind: "left"; reason: string }
  | { kind: "nothing" };

/** Carries one chat's `settings.json`, whose record folder is `dir`. */
export async function convertChatSettings(
  dir: string,
  deviceId: DeviceId,
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
  return carried.length > 0
    ? { carried, kind: "carried" }
    : { kind: "nothing" };
}

function dateIn(value: unknown): Date | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
