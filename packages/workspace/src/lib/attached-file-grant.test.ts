import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { MountedFolder } from "../schemas/mounted-folder";
import {
  AbsolutePathSchema,
  WorkDirSchema,
  WorkspaceDirSchema,
} from "../schemas/paths";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { initializeTestChat } from "../test/helpers/initialize-test-chat";
import { folderReach } from "./chat/folder-reach";
import { chatGrants } from "./chat/grants";
import { newMessage } from "./new-message";
import { reachOf, rulesFor, type Rules } from "./permissions/rules";
import { sessionOfChat } from "./record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import {
  buildBashFs,
  buildWorkspaceFsLayout,
  shellPath,
} from "./workspace-fs-layout";

/**
 * A file the person attaches is open to the chat where it is on disk, as a
 * folder they attach is, whatever Settings says about the folder holding it:
 * here a folder of theirs set to Not allowed.
 */
let root = "";
let closed = "";
let report = "";
let chatCount = 0;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "attached-")));
  closed = path.join(root, "Private");
  report = path.join(closed, "report.md");
  fs.mkdirSync(closed);
  fs.writeFileSync(report, "draft");
  fs.writeFileSync(path.join(closed, "taxes.md"), "private");
});

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true });
});

/** The rules over a chat holding `grants`, with the closed folder Not allowed. */
function rulesWith(grants: Parameters<typeof rulesFor>[0]["grants"]): Rules {
  return rulesFor({
    grants,
    home: root,
    settings: {
      apps: [],
      chats: {},
      topics: {},
      folders: [
        {
          addedAt: new Date(),
          level: "never",
          path: AbsolutePathSchema.parse(closed),
        },
      ],
      places: {},
      dangerouslyAllowEveryFolder: false,
    },
  });
}

describe("sending a file from the disk", () => {
  it("grants the chat that file where it is, and no folder", async () => {
    const chatId = ChatIdSchema.parse(`attached-file-${++chatCount}`);
    createMockChatConfigForDir(path.join(root, "tasks", chatId), {
      unplaced: true,
    });
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      chatsDir: AbsolutePathSchema.parse(path.join(root, "workspace", "chats")),
      rootDir: WorkspaceDirSchema.parse(path.join(root, "workspace")),
      workspaceMachineDir: AbsolutePathSchema.parse(path.join(root, "machine")),
    });
    await initializeTestChat({ chatId });
    const sessionId = sessionOfChat(chatId);
    if (!sessionId) {
      throw new Error("expected the chat's session");
    }

    const sent = await newMessage({
      chatId,
      files: [
        {
          filename: "report.md",
          mimeType: "text/markdown",
          path: AbsolutePathSchema.parse(report),
          size: 5,
        },
      ],
      modelURI: AIGatewayModelURI.Schema.parse(
        "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
      ),
      prompt: "Tighten this up.",
      sessionId,
    });

    expect(sent.isOk()).toBe(true);
    const grants = await chatGrants(chatId);
    expect(grants).toMatchObject([
      { kind: "file", path: report, source: "attached" },
    ]);
    expect(Object.keys(await folderReach(chatId))).not.toContain(report);
    const rules = rulesWith(grants);
    expect(reachOf(rules, report, "write").level).toBe("allow");
    expect(reachOf(rules, path.join(closed, "taxes.md"), "read").level).toBe(
      "never",
    );
  });

  // Attaching a folder says where the work is and opens it to the chat on
  // this computer, however it was attached: sent with the message, or picked
  // into the composer's chips.
  it.each([
    [
      "sent with the message",
      (folder: string) => ({ folders: [{ path: folder }] }),
    ],
    [
      "picked into the composer",
      (folder: string) => ({
        viewing: {
          chosen: [{ kind: "folder" as const, name: "Private", path: folder }],
          screen: "conversation" as const,
        },
      }),
    ],
  ])("grants a folder %s", async (_how, attach) => {
    const chatId = ChatIdSchema.parse(`attached-folder-${++chatCount}`);
    createMockChatConfigForDir(path.join(root, "tasks", chatId), {
      unplaced: true,
    });
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      chatsDir: AbsolutePathSchema.parse(path.join(root, "workspace", "chats")),
      rootDir: WorkspaceDirSchema.parse(path.join(root, "workspace")),
      workspaceMachineDir: AbsolutePathSchema.parse(path.join(root, "machine")),
    });
    await initializeTestChat({ chatId });
    const sessionId = sessionOfChat(chatId);
    if (!sessionId) {
      throw new Error("expected the chat's session");
    }

    const sent = await newMessage({
      chatId,
      ...attach(closed),
      modelURI: AIGatewayModelURI.Schema.parse(
        "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
      ),
      prompt: "Have a look in here.",
      sessionId,
    });

    expect(sent.isOk()).toBe(true);
    const grants = await chatGrants(chatId);
    expect(grants).toMatchObject([{ path: closed, source: "attached" }]);
    // The grant outranks the folder's Not allowed, as an Allow on a card does.
    expect(
      reachOf(rulesWith(grants), path.join(closed, "taxes.md"), "read").level,
    ).toBe("allow");
    expect(Object.keys(await folderReach(chatId))).toContain(closed);
  });

  it("grants nothing for a folder not on this computer", async () => {
    const chatId = ChatIdSchema.parse(`attached-folder-${++chatCount}`);
    createMockChatConfigForDir(path.join(root, "tasks", chatId), {
      unplaced: true,
    });
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      chatsDir: AbsolutePathSchema.parse(path.join(root, "workspace", "chats")),
      rootDir: WorkspaceDirSchema.parse(path.join(root, "workspace")),
      workspaceMachineDir: AbsolutePathSchema.parse(path.join(root, "machine")),
    });
    await initializeTestChat({ chatId });
    const sessionId = sessionOfChat(chatId);
    if (!sessionId) {
      throw new Error("expected the chat's session");
    }

    const sent = await newMessage({
      chatId,
      folders: [{ path: path.join(root, "On another computer") }],
      modelURI: AIGatewayModelURI.Schema.parse(
        "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
      ),
      prompt: "Have a look in here.",
      sessionId,
    });

    expect(sent.isOk()).toBe(true);
    expect(await chatGrants(chatId)).toEqual([]);
  });
});

describe("a file granted to a chat, in the shell", () => {
  it("reads and changes that file and nothing beside it", async () => {
    const layout = buildWorkspaceFsLayout({
      chatHostRoot: WorkDirSchema.parse(path.join(root, "work")),
      folders: {
        root: {
          access: "read-write",
          id: MountedFolder.IdSchema.parse("reach:root"),
          path: AbsolutePathSchema.parse(root),
        },
      },
      rules: rulesWith([
        {
          grantedAt: new Date(),
          kind: "file",
          path: AbsolutePathSchema.parse(report),
          source: "attached",
        },
      ]),
    });
    const shell = await buildBashFs(layout, { maxFileReadSize: 1024 * 1024 });

    expect(await shell.readFile(shellPath(report))).toBe("draft");
    await shell.writeFile(shellPath(report), "final");
    expect(fs.readFileSync(report, "utf8")).toBe("final");
    await expect(
      shell.readFile(shellPath(path.join(closed, "taxes.md"))),
    ).rejects.toThrow(/EACCES/);
    await expect(
      shell.writeFile(shellPath(path.join(closed, "new.md")), "x"),
    ).rejects.toThrow(/EACCES/);
  });
});
