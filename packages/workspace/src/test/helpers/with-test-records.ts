import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";

import {
  ChatRecords,
  type ChatRecordsOptions,
  installChatRecords,
} from "../../lib/records/chat-records";
import { newDeviceId } from "../../lib/records/device-id";
import { type ChatId } from "../../schemas/chat-id";

/**
 * Chat records for one test, in a real temporary chats folder, with every
 * chat's record folder named by its id in it. Nothing is synced, since
 * nothing has to survive a power cut, and the service stands in for the
 * process's own (`chatRecords()`) until the test ends, when its writes are
 * landed and the folder removed.
 *
 * ```ts
 * const records = withTestRecords();
 * it("writes a message", async () => {
 *   await records.service.startSession(chatId, { createdAt, id });
 *   expect(await fs.readdir(records.dirOf(chatId))).toHaveLength(1);
 * });
 * ```
 */
export function withTestRecords(
  options: Partial<Omit<ChatRecordsOptions, "dirOf">> = {},
) {
  let dir = "";
  let service: ChatRecords | undefined;

  beforeEach(async () => {
    dir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "chat-records-")),
    );
    service = new ChatRecords({
      app: "0.0.0-test",
      device: newDeviceId(),
      fsync: false,
      ...options,
      dirOf: (chatId) => path.join(dir, chatId),
    });
    installChatRecords(service);
  });

  afterEach(async () => {
    installChatRecords(undefined);
    await service?.dispose();
    service = undefined;
    await fs.rm(dir, { force: true, recursive: true });
  });

  return {
    /** The chats folder. */
    get dir() {
      return dir;
    },
    /** A chat's record folder. */
    dirOf: (chatId: ChatId) => path.join(dir, chatId),
    get service(): ChatRecords {
      if (!service) {
        throw new Error("Chat records exist only while a test runs");
      }
      return service;
    },
  };
}
