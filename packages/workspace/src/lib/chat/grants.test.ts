import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { chatDir } from "../record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { readChatPermissions } from "../permissions/rules";
import { chatGrants, grantFolder } from "./grants";

let chatId: ChatId;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "chat-grants-"));
  chatId = createMockChatConfigForDir(
    path.join(root, "chats", ChatIdSchema.parse("grants-test")),
  );
  await fs.mkdir(chatDir(chatId), { recursive: true });
  // The grants live in this computer's permission settings now, so each case
  // needs a machine folder of its own as much as a chat folder of its own.
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    workspaceMachineDir: AbsolutePathSchema.parse(path.join(root, "machine")),
  });
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

  // Kept on this computer, not beside the chat: a grant names a folder here,
  // and the chat's own folder travels with the workspace.
  it("writes into this computer's permission settings", async () => {
    const notes = path.join(root, "Notes");
    const photos = path.join(root, "Photos");

    await Promise.all([
      grantFolder({ chatId, path: notes, source: "attached" }),
      grantFolder({ chatId, path: photos, source: "card" }),
    ]);

    const held = await readChatPermissions(chatId);
    expect(
      held.grants
        .map(({ path: p, source }) => [p, source])
        .toSorted(([a = ""], [b = ""]) => a.localeCompare(b)),
    ).toEqual([
      [notes, "attached"],
      [photos, "card"],
    ]);
  });
});
