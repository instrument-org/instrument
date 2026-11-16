import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type ChatId } from "../schemas/chat-id";
import { AbsolutePathSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { ensureChat } from "./chat/chat-records";
import { resolveWorkspaceFilePaths } from "./resolve-workspace-file-path";
import { retireChatsFolder } from "./retire-chats-folder/retire-chats-folder";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { workspaceLayout } from "./workspace-layout";

// A chat an earlier build kept a folder for under `Chats/`, whose messages
// name files there, read after a launch emptied `Chats/` into `Files/` and
// the chat's records.

describe("a path in a chat's folder under Chats/", () => {
  let chatId: ChatId;
  let rootDir: string;

  beforeEach(async () => {
    const config = getWorkspaceConfig();
    setWorkspaceConfig({
      ...config,
      outputDir: AbsolutePathSchema.parse(config.rootDir),
    });
    rootDir = config.rootDir;
    chatId = await ensureChat(StoreId.newSessionId(), "Quiet dishwashers");
    const files = {
      "Chats/Quiet dishwashers/CHAT.md": `---\nchat: instrument://chat/${chatId}\n---\n`,
      "Chats/Quiet dishwashers/attachments/manual.pdf": "sent",
      "Chats/Quiet dishwashers/notes.md": "from the chat",
      "Files/Quiet dishwashers/notes.md": "already there",
    };
    for (const [at, text] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(rootDir, at)), {
        recursive: true,
      });
      await fs.writeFile(path.join(rootDir, at), text);
    }
    await retireChatsFolder({
      device: config.deviceId,
      filesDir: path.join(rootDir, "Files"),
      machineDir: config.workspaceMachineDir,
      rootDir,
    });
  });

  afterEach(async () => {
    // The workspace outlives each test; what this one moved and recorded goes.
    const { devicesDir } = workspaceLayout(rootDir);
    for (const at of ["Chats", "Files"]) {
      await fs.rm(path.join(rootDir, at), { force: true, recursive: true });
    }
    for (const device of await fs.readdir(devicesDir)) {
      await fs.rm(path.join(devicesDir, device, "chatfoldermoves.jsonl"), {
        force: true,
      });
    }
  });

  it.each([
    ["absolute", (root: string) => `${root}/Chats/Quiet dishwashers/notes.md`],
    ["in the workspace", () => "workspace:/Chats/Quiet dishwashers/notes.md"],
  ])(
    "opens the chat's file where a folder of its name was in Files/ (%s)",
    async (_label, spelled) => {
      const given = spelled(rootDir);
      const resolved = await resolveWorkspaceFilePaths({
        chatId,
        filePaths: [given],
      });

      const found = resolved.get(given);
      expect(found).toBe(
        path.join(rootDir, "Files", "Quiet dishwashers 2", "notes.md"),
      );
      expect(await fs.readFile(found ?? "", "utf8")).toBe("from the chat");
    },
  );

  it.each([
    [
      "absolute",
      (root: string) =>
        `${root}/Chats/Quiet dishwashers/attachments/manual.pdf`,
    ],
    [
      "in the workspace",
      () => "workspace:/Chats/Quiet dishwashers/attachments/manual.pdf",
    ],
  ])(
    "opens what the person sent in the chat's records (%s)",
    async (_label, spelled) => {
      const given = spelled(rootDir);
      const resolved = await resolveWorkspaceFilePaths({
        chatId,
        filePaths: [given],
      });

      expect(resolved.get(given)).toBe(
        path.join(
          workspaceLayout(rootDir).chatsDir,
          chatId,
          "attachments",
          "manual.pdf",
        ),
      );
    },
  );
});
