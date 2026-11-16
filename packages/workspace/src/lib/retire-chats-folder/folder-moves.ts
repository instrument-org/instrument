import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { DEVICE_ID_PATTERN, type DeviceId } from "../records/device-id";
import { SyncedFold } from "../synced-store/synced-fold";
import { openSyncedStore } from "../synced-store/synced-store";
import { isSyncedFileName } from "../synced-store/synced-record";

/**
 * Where each folder an earlier build kept under `Chats/` went when that
 * folder was emptied into `Files/`, so a path an older chat's messages name
 * in `Chats/<name>/` opens the file where it is now.
 *
 * A synced store (`.instrument/devices/<device>/chatfoldermoves.jsonl`), one
 * key per folder by its old name: every computer sharing the workspace reads
 * what the computer that moved a folder wrote, and two computers that each
 * moved some never write the same file.
 */
const DOMAIN = "chatfoldermoves";
const KEY_PREFIX = "move/";

/** Where one folder went. */
export interface ChatFolderMove {
  /** The chat whose folder it was, where that was known. */
  chat?: ChatId;
  /** Its name under `Chats/`. */
  from: string;
  /** Its name under `Files/`. */
  to: string;
}

const MoveSchema = z.object({
  chat: ChatIdSchema.optional(),
  to: z.string().min(1),
});

/** Records the folders moved, in this device's file of the store. */
export async function recordChatFolderMoves({
  device,
  devicesDir,
  moves,
}: {
  device: DeviceId;
  devicesDir: string;
  moves: readonly ChatFolderMove[];
}): Promise<void> {
  if (moves.length === 0) {
    return;
  }
  const store = await openChatFolderMoves({ device, devicesDir });
  try {
    await store.record(moves);
  } finally {
    store.close();
  }
}

/** This device's file of the store, open for one sweep's moves. */
export interface ChatFolderMovesWriter {
  close(): void;
  /** Takes back where a folder was to go, when it stayed where it was. */
  forget(from: string): Promise<void>;
  record(moves: readonly ChatFolderMove[]): Promise<void>;
}

export async function openChatFolderMoves({
  device,
  devicesDir,
}: {
  device: DeviceId;
  devicesDir: string;
}): Promise<ChatFolderMovesWriter> {
  const store = await openSyncedStore({
    device,
    devicesDir,
    domain: DOMAIN,
    watch: false,
  });
  return {
    close: () => store.close(),
    forget: (from) => store.apply([{ key: keyOf(from), t: "del" }]),
    record: (moves) =>
      store.apply(
        moves.map(({ chat, from, to }) => ({
          key: keyOf(from),
          t: "set",
          value: chat === undefined ? { to } : { chat, to },
        })),
      ),
  };
}

function keyOf(from: string): string {
  return `${KEY_PREFIX}${from.normalize("NFC")}`;
}

/**
 * Every folder moved out of `Chats/`, by its old name, as every device's
 * file of the store says. Empty where none was, which is one listing of the
 * devices folder.
 */
export async function readChatFolderMoves(
  devicesDir: string,
): Promise<Map<string, ChatFolderMove>> {
  const fold = new SyncedFold();
  const device = new RegExp(`^${DEVICE_ID_PATTERN}$`);
  for (const folder of await namesIn(devicesDir)) {
    if (!device.test(folder)) {
      continue;
    }
    for (const name of await namesIn(path.join(devicesDir, folder))) {
      if (!isSyncedFileName(name, DOMAIN)) {
        continue;
      }
      const file = path.join(devicesDir, folder, name);
      const bytes = await fs.readFile(file).catch(() => undefined);
      if (bytes !== undefined) {
        fold.add(file, bytes);
      }
    }
  }
  const moves = new Map<string, ChatFolderMove>();
  for (const [key, value] of fold.entries(KEY_PREFIX)) {
    const parsed = MoveSchema.safeParse(value);
    if (parsed.success) {
      const from = key.slice(KEY_PREFIX.length);
      moves.set(from, { ...parsed.data, from });
    }
  }
  return moves;
}

async function namesIn(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}
