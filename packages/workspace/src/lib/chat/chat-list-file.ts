import path from "node:path";
import { isEqual, pick } from "radashi";

import { updateJsonRecord } from "../json-record-file";
import { type DeviceId } from "../records/device-id";
import { getWorkspaceConfig } from "../workspace-config";
import { workspaceLayout } from "../workspace-layout";
import { type Chat } from "./chats";
import { liveChatList } from "./live-chat-list";

/**
 * Every chat's row as this device lists it, written whole into this device's
 * own `.instrument/devices/<device>/chat-list.json`, for a device that reads
 * the workspace through a sync engine and cannot afford to read every chat's
 * records before it shows a list. A phone opening an iCloud Drive workspace
 * lists each chat by listing its folder, which waits on the sync engine
 * folder by folder: minutes for a thousand chats, where this one file takes
 * seconds.
 *
 * Derived, like `workspace.db`, and never the truth: a reader takes the
 * newest of the devices' files by `writtenAt` to show a list at once, and
 * reads the chats' records behind it as they arrive. One writer per file,
 * as everything in the folder has, so a sync engine never has two versions
 * of it to choose between.
 */
export const CHAT_LIST_FILE_NAME = "chat-list.json";

/** The file's shape, which a reader checks before it reads the rows. */
const CHAT_LIST_FORMAT = 1;

/**
 * How long after the list moves the file is written: at most once in this
 * long while a chat is busy, since each write sends the whole file to the
 * sync engine again. A reader keeps up with a chat it has open from that
 * chat's records, so the file only has to be close.
 */
const WRITE_AFTER_MS = 10_000;

/**
 * What a row in the file carries: what a list shows of a chat at rest.
 * What only this process knows while it runs (a turn under way, the tasks at
 * work, the step a turn is on) stays out, and so does the opening message,
 * which can carry whole attachments.
 */
const ROW_FIELDS = [
  "archived",
  "createdAt",
  "holds",
  "id",
  "lastAsk",
  "lastReplyAt",
  "lastUserMessageAt",
  "latest",
  "sessionId",
  "starred",
  "state",
  "title",
  "titled",
  "topic",
  "unread",
  "unreadByUser",
  "updatedAt",
] as const satisfies (keyof Chat)[];

type ChatListRow = Pick<Chat, (typeof ROW_FIELDS)[number]>;

/** The file's contents for a list of chats. */
function chatListFile(
  chats: readonly Chat[],
  { device, writtenAt }: { device: DeviceId; writtenAt: Date },
): {
  chats: ChatListRow[];
  device: DeviceId;
  format: number;
  writtenAt: string;
} {
  return {
    chats: chats.map((chat) => pick(chat, [...ROW_FIELDS])),
    device,
    format: CHAT_LIST_FORMAT,
    writtenAt: writtenAt.toISOString(),
  };
}

/**
 * Writes the file from the live chat list for as long as the process runs:
 * once the list is first read, then at most every `WRITE_AFTER_MS` while it
 * moves, and not at all for a move that leaves every row the file carries
 * as it was (a step a running turn is on, say). Stops with `signal`.
 */
export function startChatListFile({
  signal,
  writeAfterMs = WRITE_AFTER_MS,
}: { signal?: AbortSignal; writeAfterMs?: number } = {}): void {
  const config = getWorkspaceConfig();
  const file = path.join(
    workspaceLayout(config.rootDir).devicesDir,
    config.deviceId,
    CHAT_LIST_FILE_NAME,
  );
  let latest: readonly Chat[] = [];
  let written: ChatListRow[] | undefined;
  let timer: NodeJS.Timeout | undefined;

  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
  });

  const write = async () => {
    timer = undefined;
    const contents = chatListFile(latest, {
      device: config.deviceId,
      writtenAt: new Date(),
    });
    if (written !== undefined && isEqual(contents.chats, written)) {
      return;
    }
    try {
      await updateJsonRecord(file, () => contents);
      written = contents.chats;
    } catch (error) {
      config.captureException(error);
    }
  };

  void (async () => {
    try {
      let first = true;
      for await (const chats of liveChatList(signal)) {
        latest = chats;
        if (first) {
          first = false;
          void write();
        } else {
          timer ??= setTimeout(() => void write(), writeAfterMs);
        }
      }
    } catch (error) {
      if (!signal?.aborted) {
        config.captureException(error);
      }
    }
  })();
}
