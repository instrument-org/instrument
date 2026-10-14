import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema } from "../../schemas/paths";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { getChatSettings } from "../chat-settings";
import { recordMovedPaths } from "../moved-paths";
import { chatDir } from "../record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
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

// A grant names a folder by its path on this computer, which a migration can
// move: one into a workspace folder the app has since moved is still that
// folder's grant.
describe("a grant stored before a migration moved its folder", () => {
  it("is read, kept, and taken away where its folder is now", async () => {
    const machineDir = path.join(root, "machine");
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      workspaceMachineDir: AbsolutePathSchema.parse(machineDir),
    });
    const before = path.join(root, "workspace", "skills", "brief");
    const now = path.join(root, "workspace", ".instrument", "skills", "brief");
    const stored = await grantFolder({
      chatId,
      path: before,
      source: "attached",
    });
    await fs.mkdir(now, { recursive: true });
    recordMovedPaths(machineDir, [
      {
        from: path.join(root, "workspace", "skills"),
        to: path.join(root, "workspace", ".instrument", "skills"),
      },
    ]);

    expect(await chatGrants(chatId)).toEqual([{ ...stored, path: now }]);
    expect(await grantFolder({ chatId, path: now, source: "card" })).toEqual({
      ...stored,
      path: now,
    });
    expect(await chatGrants(chatId)).toHaveLength(1);

    await revokeGrant({ chatId, path: now });

    expect(await chatGrants(chatId)).toEqual([]);
  });
});
