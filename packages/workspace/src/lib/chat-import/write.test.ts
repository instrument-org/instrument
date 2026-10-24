import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { ChatIdSchema } from "../../schemas/chat-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { StoreId } from "../../schemas/store-id";
import { ChatReads } from "../chat-reads";
import { ChatWrites } from "../chat-writes";
import { listChats } from "../chat/chats";
import { listInvalidChatFolders } from "../invalid-chat-folders";
import {
  chatDir,
  chatIds,
  forgetChatFolders,
  sessionOfChat,
} from "../record-folders";
import { parseLogLine } from "../records/record";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { importedChats } from "./imported";
import { type ImportedTranscript, importKey } from "./model";
import { clearStaleImports, omittedLine, writeImportedChat } from "./write";

vi.mock(import("../chat/activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  chatActivity: () => Promise.resolve({ running: [] }),
}));
vi.mock(import("../workspace-actor-ref"), () => ({
  getWorkspaceActorRef: () =>
    ({
      getSnapshot: () => ({
        context: { sessionRefsByChatId: { get: () => [] } },
      }),
    }) as never,
  setWorkspaceActorRef: vi.fn(),
}));

let root = "";
let counter = 0;

beforeEach(() => {
  createMockChatConfig(
    ChatIdSchema.parse(`import-${Date.now()}-${(counter += 1)}`),
    { unplaced: true },
  );
  root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "chat-import-")),
  );
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    legacyTasksDir: AbsolutePathSchema.parse(path.join(root, "tasks")),
    rootDir: WorkspaceDirSchema.parse(root),
  });
  forgetChatFolders();
});

afterEach(() => {
  fs.rmSync(root, { force: true, recursive: true });
});

const at = (day: number, minute = 0) =>
  new Date(Date.UTC(2025, 2, day, 15, minute));

function transcript(
  overrides: Partial<ImportedTranscript> = {},
): ImportedTranscript {
  return {
    createdAt: at(3),
    kind: "chatgpt-export",
    messages: [
      {
        createdAt: at(3),
        role: "user",
        text: "What tile works in a small kitchen?",
      },
      {
        createdAt: at(3, 1),
        model: "gpt-5",
        omitted: { toolCalls: { web_search: 2, python: 1 } },
        role: "assistant",
        text: "Large-format porcelain keeps grout lines down.",
      },
      {
        createdAt: at(4),
        omitted: { attachments: 1 },
        role: "user",
        text: "",
      },
      {
        createdAt: at(4, 2),
        role: "assistant",
        text: "That backsplash would suit a matte finish.",
      },
    ],
    sourceId: "conv-1",
    title: "Kitchen remodel",
    updatedAt: at(4, 2),
    ...overrides,
  };
}

describe("writeImportedChat", () => {
  it("writes a chat dated from the source, titled and settled", async () => {
    const chatId = (await writeImportedChat(transcript()))._unsafeUnwrap();
    expect(chatId).toMatch(/^2025-03-03-kitchen-remodel-[0-9a-z]{4}$/);

    const [row] = await listChats();
    expect({
      createdAt: new Date(row?.createdAt ?? 0).toISOString(),
      id: row?.id === chatId,
      lastUserMessageAt: new Date(row?.lastUserMessageAt ?? 0).toISOString(),
      title: row?.title,
      titleByApp: row?.titleByApp,
      unread: row?.unread,
      updatedAt: new Date(row?.updatedAt ?? 0).toISOString(),
    }).toMatchInlineSnapshot(`
      {
        "createdAt": "2025-03-03T15:00:00.000Z",
        "id": true,
        "lastUserMessageAt": "2025-03-04T15:00:00.000Z",
        "title": "Kitchen remodel",
        "titleByApp": false,
        "unread": false,
        "updatedAt": "2025-03-04T15:02:00.000Z",
      }
    `);

    const sessionId = sessionOfChat(chatId);
    if (!sessionId) {
      throw new Error("not placed");
    }
    const session = (
      await ChatReads.sessionWithMessages({ chatId, sessionId })
    )._unsafeUnwrap();
    expect(
      session.messages.map((message) => ({
        at: message.metadata.createdAt.toISOString(),
        model: "modelId" in message.metadata ? message.metadata.modelId : null,
        role: message.role,
        text: message.parts.map((part) =>
          part.type === "text" ? part.text : part.type,
        ),
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "at": "2025-03-03T15:00:00.000Z",
          "model": null,
          "role": "user",
          "text": [
            "What tile works in a small kitchen?",
          ],
        },
        {
          "at": "2025-03-03T15:01:00.000Z",
          "model": "gpt-5",
          "role": "assistant",
          "text": [
            "Large-format porcelain keeps grout lines down.

      _Not imported: 3 tool calls._",
          ],
        },
        {
          "at": "2025-03-04T15:00:00.000Z",
          "model": null,
          "role": "user",
          "text": [
            "Not imported: 1 attachment.",
          ],
        },
        {
          "at": "2025-03-04T15:02:00.000Z",
          "model": "unknown",
          "role": "assistant",
          "text": [
            "That backsplash would suit a matte finish.",
          ],
        },
      ]
    `);
    expect({
      createdAt: session.createdAt.toISOString(),
      titleSettled: session.titleSettledAt !== undefined,
    }).toMatchInlineSnapshot(`
      {
        "createdAt": "2025-03-03T15:00:00.000Z",
        "titleSettled": true,
      }
    `);
    const settings = (
      await ChatReads.settings({ chatId, sessionId })
    )._unsafeUnwrap();
    expect(Object.keys(settings)).toMatchInlineSnapshot(`
      [
        "title",
      ]
    `);
  });

  it("names where it came from in its own session's header", async () => {
    const chatId = (await writeImportedChat(transcript()))._unsafeUnwrap();
    const [log] = fs
      .readdirSync(chatDir(chatId))
      .filter((name) => name.startsWith("ses_"));
    const header = parseLogLine(
      fs
        .readFileSync(path.join(chatDir(chatId), log ?? ""), "utf8")
        .split("\n")[0] ?? "",
    );
    expect(header?.t === "session" && header.imported).toMatchInlineSnapshot(`
      {
        "kind": "chatgpt-export",
        "sourceId": "conv-1",
      }
    `);

    forgetChatFolders();
    const imported = await importedChats();
    expect(
      imported.get(importKey({ kind: "chatgpt-export", sourceId: "conv-1" })),
    ).toBe(chatId);
  });

  it("keeps naming its source in a log continuing it", async () => {
    const chatId = (await writeImportedChat(transcript()))._unsafeUnwrap();
    const sessionId = sessionOfChat(chatId);
    if (!sessionId) {
      throw new Error("not placed");
    }
    const messageId = StoreId.newMessageId();
    const createdAt = new Date();
    (
      await ChatWrites.saveMessageWithParts(
        {
          id: messageId,
          metadata: { createdAt, sessionId },
          parts: [
            {
              metadata: {
                createdAt,
                id: StoreId.newPartId(),
                messageId,
                sessionId,
              },
              text: "And for the floor?",
              type: "text",
            },
          ],
          role: "user",
        },
        chatId,
      )
    )._unsafeUnwrap();
    await ChatWrites.landed(chatId);
    const headers = fs
      .readdirSync(chatDir(chatId))
      .filter((name) => name.startsWith("ses_"))
      .map((name) =>
        parseLogLine(
          fs
            .readFileSync(path.join(chatDir(chatId), name), "utf8")
            .split("\n")[0] ?? "",
        ),
      );
    expect(headers).toHaveLength(2);
    expect(
      headers.map((header) => header?.t === "session" && header.imported),
    ).toEqual([
      { kind: "chatgpt-export", sourceId: "conv-1" },
      { kind: "chatgpt-export", sourceId: "conv-1" },
    ]);
  });

  it("leaves no staging folder, and the index never lists one", async () => {
    const stale = path.join(root, "chats", ".~import-999999999-1.tmp");
    fs.mkdirSync(stale, { recursive: true });
    forgetChatFolders();
    expect(chatIds()).toEqual([]);
    expect(await listInvalidChatFolders()).toEqual([]);

    await writeImportedChat(transcript());
    await clearStaleImports();
    expect(
      fs
        .readdirSync(path.join(root, "chats"))
        .filter((name) => name.startsWith(".")),
    ).toEqual([]);
  });

  it("refuses a chat with nothing from the person in it", async () => {
    const result = await writeImportedChat(
      transcript({
        messages: [{ createdAt: at(3), role: "assistant", text: "Hello." }],
      }),
    );
    expect(result._unsafeUnwrapErr().message).toMatchInlineSnapshot(
      `"It has no message from the person to start it."`,
    );
    expect(fs.existsSync(path.join(root, "chats"))).toBe(false);
  });
});

describe("omittedLine", () => {
  it.each([
    [{}, ""],
    [{ attachments: 1 }, "_Not imported: 1 attachment._"],
    [
      { attachments: 2, toolCalls: { bash: 2, read: 1 } },
      "_Not imported: 3 tool calls and 2 attachments._",
    ],
  ])("%j", (omitted, line) => {
    expect(omittedLine(omitted)).toBe(line);
  });
});

describe("the session header", () => {
  it("reads a source this build does not know as no provenance", async () => {
    const chatId = (await writeImportedChat(transcript()))._unsafeUnwrap();
    const [log] = fs
      .readdirSync(chatDir(chatId))
      .filter((name) => name.startsWith("ses_"));
    const written: unknown = JSON.parse(
      fs
        .readFileSync(path.join(chatDir(chatId), log ?? ""), "utf8")
        .split("\n")[0] ?? "",
    );
    const header = parseLogLine(
      JSON.stringify({
        ...(typeof written === "object" ? written : {}),
        imported: { kind: "gemini-takeout", sourceId: "x" },
      }),
    );
    expect(header?.t).toBe("session");
    expect(header?.t === "session" && header.imported).toBeUndefined();
  });
});
