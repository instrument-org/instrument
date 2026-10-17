import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { createMockChatConfigForDir } from "../../test/helpers/mock-chat-config";
import { ChatDirSchema } from "../../schemas/paths";
import { updateChatRecord, readChatRecord } from "../chat-record";
import { chatDir } from "../record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { moveChatPermissions } from "./move-chat-permissions";
import { readChatPermissions, updateChatPermissions } from "./rules";

let root = "";
let chatId: ReturnType<typeof createMockChatConfigForDir>;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "move-perms-")));
  const chats = path.join(root, "workspace", ".instrument", "chats", "a-chat");
  fs.mkdirSync(chats, { recursive: true });
  chatId = createMockChatConfigForDir(ChatDirSchema.parse(chats));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(path.join(root, "workspace")),
    workspaceMachineDir: AbsolutePathSchema.parse(path.join(root, "machine")),
  });
});

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true });
});

/** What an older build wrote beside the chat. */
async function writeBesideTheChat(held: Record<string, unknown>) {
  await updateChatRecord(chatDir(chatId), "settings", (record) => ({
    ...record.raw,
    ...held,
  }));
}

const granted = {
  grantedAt: new Date(0).toISOString(),
  path: "/Users/sam/Documents/Acme",
  source: "card",
};

it("carries what a chat held onto this computer and leaves the chat clean", async () => {
  await writeBesideTheChat({
    appGrants: [
      {
        app: "Reminders",
        bundleId: "com.apple.reminders",
        grantedAt: new Date(0).toISOString(),
      },
    ],
    denials: [
      {
        deniedAt: new Date(0).toISOString(),
        kind: "folder",
        target: "/Users/sam/Private",
      },
    ],
    grants: [granted],
  });

  expect(await moveChatPermissions()).toEqual({ moved: 1 });

  const held = await readChatPermissions(chatId);
  expect(held.grants.map((grant) => grant.path)).toEqual([granted.path]);
  expect(held.appGrants.map((grant) => grant.app)).toEqual(["Reminders"]);
  expect(held.denials.map((denial) => denial.target)).toEqual([
    "/Users/sam/Private",
  ]);

  // The chat's own settings no longer name anything on this computer.
  const record = await readChatRecord(chatDir(chatId));
  const raw = record.raw as Record<string, unknown>;
  expect(raw.grants).toBeUndefined();
  expect(raw.appGrants).toBeUndefined();
  expect(raw.denials).toBeUndefined();
});

it("passes over a chat holding none, and runs again safely", async () => {
  expect(await moveChatPermissions()).toEqual({ moved: 0 });

  await writeBesideTheChat({ grants: [granted] });
  expect(await moveChatPermissions()).toEqual({ moved: 1 });
  expect(await moveChatPermissions()).toEqual({ moved: 0 });
  expect((await readChatPermissions(chatId)).grants).toHaveLength(1);
});

it("keeps an answer given here over the one the chat carried", async () => {
  // A second run must never write over what the person said since the first.
  await updateChatPermissions(chatId, (held) => ({
    ...held,
    grants: [
      {
        grantedAt: new Date(10),
        path: AbsolutePathSchema.parse("/Users/sam/Documents/Newer"),
        source: "card" as const,
      },
    ],
  }));
  await writeBesideTheChat({ grants: [granted] });

  await moveChatPermissions();

  expect((await readChatPermissions(chatId)).grants.map((g) => g.path)).toEqual(
    ["/Users/sam/Documents/Newer"],
  );
});
