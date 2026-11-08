import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { type Environment } from "../schemas/environment";
import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { ensureChat } from "./chat/chat-records";
import { ChatWrites } from "./chat-writes";
import { chatFolderNames } from "./chat-folders/own-folder";
import { sessionOfChat } from "./record-folders";
import {
  computersHolding,
  resolveWorkspaceFilePaths,
} from "./resolve-workspace-file-path";
import { getWorkspaceConfig } from "./workspace-config";

// A chat that ran on another computer and is read on this one: its messages
// keep paths as that computer spelled them, under its home and its place for
// the workspace, and in the chat's folder under the name it had then.

const OTHER_HOME = "/Users/other-mac-user";
const OTHER_ROOT = `${OTHER_HOME}/Library/Mobile Documents/com~apple~CloudDocs/Instrument`;
const OTHER_WINDOWS_ROOT = "/c/Users/windows-user/Instrument";

function toldOn(
  environment: Environment,
  sessionId: StoreId.Session,
): SessionMessage.ContextWithParts {
  const id = StoreId.newMessageId();
  const createdAt = new Date();
  return {
    id,
    metadata: {
      agentName: "instrument",
      createdAt,
      environment,
      realRole: "user",
      sessionId,
    },
    parts: [
      {
        metadata: {
          createdAt,
          id: StoreId.newPartId(),
          messageId: id,
          sessionId,
        },
        state: "done",
        text: "<system_info>…</system_info>",
        type: "text",
      },
    ],
    role: "session-context",
  };
}

/** The note a branch's copied history ends on, naming the chat it came from. */
function branchedFrom(
  chat: ChatId,
  sessionId: StoreId.Session,
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  const createdAt = new Date();
  return {
    id,
    metadata: { createdAt, sessionId },
    parts: [
      {
        data: { chat, records: "/records", title: "Original", work: "/work" },
        metadata: {
          createdAt,
          id: StoreId.newPartId(),
          messageId: id,
          sessionId,
        },
        type: "data-branchedFrom",
      },
    ],
    role: "user",
  };
}

const OTHER_MAC: Environment = {
  appsFolder: `${OTHER_ROOT}/Apps`,
  computer: "Other Mac, macOS 27.0.1",
  homeFolder: OTHER_HOME,
  outputFolder: `${OTHER_ROOT}/Chats/Is there something new`,
  platform: "darwin",
  timeZone: "America/Chicago",
  workspaceSkillsFolder: `${OTHER_ROOT}/Skills`,
};

const WINDOWS_PC: Environment = {
  appsFolder: `${OTHER_WINDOWS_ROOT}/Apps`,
  computer: "Windows PC, Windows 11",
  homeFolder: "/c/Users/windows-user",
  outputFolder: `${OTHER_WINDOWS_ROOT}/Chats/Is there something new`,
  platform: "win32",
  timeZone: "America/Chicago",
  workspaceSkillsFolder: `${OTHER_WINDOWS_ROOT}/Skills`,
};

describe("a chat written on another computer", () => {
  let chatId: ChatId;
  let ownFolder: string;
  let rootDir: string;

  beforeEach(async () => {
    const sessionId = StoreId.newSessionId();
    chatId = await ensureChat(sessionId, "Caffeinated water enhancers");
    rootDir = getWorkspaceConfig().rootDir;
    const name = chatFolderNames(getWorkspaceConfig().workspaceMachineDir).get(
      chatId,
    );
    if (name === undefined) {
      throw new Error("the chat has no folder");
    }
    ownFolder = path.join(rootDir, "Chats", name);
    await fs.mkdir(ownFolder, { recursive: true });
    await fs.writeFile(path.join(ownFolder, "explained.md"), "made");
    await fs.mkdir(path.join(rootDir, "Projects", "Drinks"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(rootDir, "Projects", "Drinks", "notes.md"),
      "notes",
    );
    const session = sessionOfChat(chatId);
    if (!session) {
      throw new Error("the chat has no session");
    }
    for (const told of [OTHER_MAC, WINDOWS_PC]) {
      await ChatWrites.saveMessageWithParts(toldOn(told, session), chatId);
    }
  });

  it.each([
    [
      "a file in the chat's folder, under the name it had there",
      `${OTHER_ROOT}/Chats/Is there something new/explained.md`,
      () => path.join(ownFolder, "explained.md"),
    ],
    [
      "a file elsewhere in its workspace",
      `${OTHER_ROOT}/Projects/Drinks/notes.md`,
      () => path.join(rootDir, "Projects", "Drinks", "notes.md"),
    ],
    [
      "a file in the chat's folder, spelled the Windows way",
      "C:\\Users\\windows-user\\Instrument\\Chats\\Is there something new\\explained.md",
      () => path.join(ownFolder, "explained.md"),
    ],
  ])("finds %s here", async (_label, given, expected) => {
    const resolved = await resolveWorkspaceFilePaths({
      filePaths: [given],
      chatId,
    });

    expect(resolved.get(given)).toBe(expected());
  });

  it("names the computer that has a file it kept outside the workspace", async () => {
    const desktop = `${OTHER_HOME}/Desktop/draft.md`;
    const inWorkspace = `${OTHER_ROOT}/Projects/Drinks/gone.md`;
    const nowhere = "/Volumes/Nobody/file.md";

    const filePaths = [desktop, inWorkspace, nowhere];
    const resolved = await resolveWorkspaceFilePaths({ filePaths, chatId });
    const holding = await computersHolding({ filePaths, chatId });

    expect(resolved.get(desktop)).toBeNull();
    expect(Object.fromEntries(holding)).toEqual({ [desktop]: "Other Mac" });
  });
});

describe("a branch of a chat written on another computer", () => {
  // The branch's copied history was told the original chat's folder, on the
  // computer it ran on, so a file a copied reply named there is the
  // original's, in its folder as it is named here now.
  it("finds a copied reply's file in the original's folder", async () => {
    const original = await ensureChat(StoreId.newSessionId(), "Original chat");
    const branchSession = StoreId.newSessionId();
    const branch = await ensureChat(branchSession, "Branch of it");
    const { rootDir, workspaceMachineDir } = getWorkspaceConfig();
    const originalName = chatFolderNames(workspaceMachineDir).get(original);
    if (originalName === undefined) {
      throw new Error("the original has no folder");
    }
    const originalFolder = path.join(rootDir, "Chats", originalName);
    await fs.mkdir(originalFolder, { recursive: true });
    await fs.writeFile(path.join(originalFolder, "made.md"), "made");
    const session = sessionOfChat(branch);
    if (!session) {
      throw new Error("the branch has no session");
    }
    await ChatWrites.saveMessageWithParts(toldOn(OTHER_MAC, session), branch);
    await ChatWrites.saveMessageWithParts(
      branchedFrom(original, session),
      branch,
    );

    const given = `${OTHER_ROOT}/Chats/Is there something new/made.md`;
    const resolved = await resolveWorkspaceFilePaths({
      filePaths: [given],
      chatId: branch,
    });

    expect(resolved.get(given)).toBe(path.join(originalFolder, "made.md"));
  });
});
