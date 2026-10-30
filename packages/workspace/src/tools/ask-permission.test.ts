import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { openAsks } from "../lib/chat/open-asks";
import { grantFolder } from "../lib/chat/grants";
import { ChatWrites } from "../lib/chat-writes";
import { sessionOfChat } from "../lib/record-folders";
import { ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { shellPath } from "../lib/workspace-fs-layout";
import { runTool } from "../test/helpers/run-tool";
import { AskPermission } from "./ask-permission";

const model = createMockAIGatewayModel();
// A home of its own, with the folders a Mac's has, so every computer the
// suite runs on decides the same.
const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "ask-home-")));
for (const folder of ["Desktop", "Music"]) {
  mkdirSync(path.join(home, folder));
}
vi.spyOn(os, "homedir").mockReturnValue(home);

/** `value` with the home folder written `~`, as the host or the shell spells it. */
function inHome(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value), (_key, field: unknown) =>
    typeof field === "string" &&
    (field.includes(home) || field.includes(shellPath(home)))
      ? field
          .replaceAll(home, "~")
          .replaceAll(shellPath(home), "~")
          .replaceAll(path.sep, "/")
      : field,
  );
}

/** A chat with its own session started, whose log its cards are written to. */
async function chatNamed(name: string) {
  const chatId = createMockChatConfig(ChatIdSchema.parse(name), { model });
  const sessionId = sessionOfChat(chatId);
  if (sessionId === undefined) {
    throw new Error("expected the chat's session");
  }
  await ChatWrites.saveSession(
    { createdAt: new Date(), id: sessionId, title: name },
    chatId,
  );
  return chatId;
}

async function ask(
  chatId: ReturnType<typeof createMockChatConfig>,
  kind: "app" | "folder",
  target: string,
  partId = StoreId.newPartId(),
  sessionId = StoreId.newSessionId(),
) {
  const result = await runTool(AskPermission, {
    chatId,
    input: { kind, reason: "So I can put the copy there.", target },
    model,
    partId,
    sessionId,
    signal: AbortSignal.timeout(10_000),
  });
  return result._unsafeUnwrap();
}

describe("ask_permission", () => {
  it("decides what to ask for", async () => {
    const chatId = await chatNamed("ask-permission-decides");
    const decided: Record<string, unknown> = {};
    for (const target of [
      "~/Desktop/copy.md",
      "~/Desktop/Trips/2026",
      "~/Music/Loops",
      "~",
      "~/notes.md",
      "Desktop",
    ]) {
      decided[target] = await ask(chatId, "folder", target);
    }
    expect(inHome(decided)).toMatchInlineSnapshot(`
        {
          "Desktop": {
            "message": ""Desktop" is not a full path. Ask for the folder by its full path.",
            "state": "refused",
          },
          "~": {
            "message": ""~" is directly in "~", which can't be asked for whole. Work in your work folder, or a folder the person names.",
            "state": "refused",
          },
          "~/Desktop/Trips/2026": {
            "agentTarget": "~/Desktop",
            "kind": "folder",
            "state": "asked",
            "target": "~/Desktop",
          },
          "~/Desktop/copy.md": {
            "agentTarget": "~/Desktop",
            "kind": "folder",
            "state": "asked",
            "target": "~/Desktop",
          },
          "~/Music/Loops": {
            "agentTarget": "~/Music",
            "kind": "folder",
            "state": "asked",
            "target": "~/Music",
          },
          "~/notes.md": {
            "message": ""~/notes.md" is directly in "~", which can't be asked for whole. Work in your work folder, or a folder the person names.",
            "state": "refused",
          },
        }
      `);
  });

  it("puts the card up once, with the reason and the call that asked", async () => {
    const chatId = await chatNamed("ask-permission-card");
    const partId = StoreId.newPartId();
    const sessionId = StoreId.newSessionId();
    await ask(chatId, "folder", "~/Desktop/a.md", partId, sessionId);
    await ask(chatId, "folder", "~/Desktop/b.md", undefined, sessionId);
    expect(await openAsks(chatId)).toEqual([
      expect.objectContaining({
        askers: [
          expect.objectContaining({
            partId,
            reason: "So I can put the copy there.",
          }),
        ],
        kind: "folder",
        status: "open",
        target: path.join(home, "Desktop"),
      }),
    ]);
  });

  it("raises no card for a folder the chat already has", async () => {
    const chatId = createMockChatConfig(
      ChatIdSchema.parse("ask-permission-granted"),
      { model },
    );
    await grantFolder({
      chatId,
      path: path.join(home, "Desktop"),
      source: "card",
    });
    expect((await ask(chatId, "folder", "~/Desktop/a.md")).state).toBe(
      "allowed",
    );
    expect(await openAsks(chatId)).toEqual([]);
  });

  it("refuses an app this computer does not have", async () => {
    const chatId = createMockChatConfig(
      ChatIdSchema.parse("ask-permission-app"),
      {
        model,
      },
    );
    expect(await ask(chatId, "app", "No Such App Here")).toEqual({
      message: 'No app called "No Such App Here" is on this computer.',
      state: "refused",
    });
  });

  it.runIf(process.platform === "darwin")(
    "asks for a Mac app by its name",
    async () => {
      const chatId = await chatNamed("ask-permission-shortcuts");
      expect(await ask(chatId, "app", "Shortcuts")).toEqual({
        kind: "app",
        state: "asked",
        target: "Shortcuts",
      });
    },
  );

  // Connecting one of these in Apps covers every chat, so a chat has nothing
  // of its own to ask for.
  it.runIf(process.platform === "darwin")(
    "sends one of the Mac apps in Apps to its app",
    async () => {
      const chatId = createMockChatConfig(
        ChatIdSchema.parse("ask-permission-messages"),
        { model },
      );
      expect(await ask(chatId, "app", "Messages")).toMatchObject({
        message: expect.stringContaining(
          "`instrument app call apple-messages`",
        ),
        state: "refused",
      });
    },
  );

  it("ends the turn with the model told the card is up", () => {
    expect(
      AskPermission.toModelOutput({
        input: { kind: "folder", reason: "To copy it.", target: "~/Desktop" },
        output: {
          kind: "folder",
          state: "asked",
          target: "/Users/sam/Desktop",
        },
        toolCallId: "test",
      }),
    ).toMatchInlineSnapshot(`
      {
        "type": "text",
        "value": "The user now sees a card asking for "/Users/sam/Desktop". Their answer reaches you as a message of its own.",
      }
    `);
  });
});
