import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { getChatSettings } from "../chat-settings";
import { chatDir } from "../record-folders";
import { chatGrants, grantFolder, revokeGrant } from "./grants";

let chatId: ChatId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "chat-grants-"));
  chatId = createMockChatConfigForDir(
    path.join(root, "chats", ChatIdSchema.parse("grants-test")),
  );
  await fs.mkdir(chatDir(chatId), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

describe("grantFolder", () => {
  // A second grant of one path would give the agent two names for one folder,
  // and a fresh date would let a later namesake take its name.
  it("keeps one grant, and its date, for a folder granted twice", async () => {
    const notes = path.join(root, "Notes");

    const first = await grantFolder({
      chatId,
      path: notes,
      source: "attached",
    });
    const second = await grantFolder({ chatId, path: notes, source: "card" });

    expect(second).toEqual(first);
    expect(await chatGrants(chatId)).toEqual([first]);
  });

  it("writes beside the chat's other settings", async () => {
    const notes = path.join(root, "Notes");
    const photos = path.join(root, "Photos");

    await Promise.all([
      grantFolder({ chatId, path: notes, source: "attached" }),
      grantFolder({ chatId, path: photos, source: "card" }),
    ]);
    await revokeGrant({ chatId, path: notes });

    const settings = await getChatSettings(chatDir(chatId));
    expect(settings?.grants?.map(({ path: p, source }) => [p, source])).toEqual(
      [[photos, "card"]],
    );
  });
});
