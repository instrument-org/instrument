import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { call } from "@orpc/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateChatSettings } from "../../lib/chat-settings";
import { appRefusal } from "../../lib/permissions/apps";
import { openAsks, recordAsk } from "../../lib/chat/asks";
import { chatDenials } from "../../lib/permissions/denials";
import { readPermissionSettings } from "../../lib/permissions/rules";
import { sessionOfChat } from "../../lib/record-folders";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";
import { type WorkspaceActorRef } from "../../machines/workspace";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { chatTaskFor } from "../../test/helpers/chat-task";
import { type WorkspaceRPCContext } from "../base";
import { permissions } from "./permissions";

vi.mock(import("../../lib/session-store-storage"));

vi.mock(import("@instrument-org/ai-gateway"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchModel: () => Promise.resolve({ ok: true, value: {} } as never),
}));

function createContext(): WorkspaceRPCContext {
  return {
    workspaceConfig: getWorkspaceConfig(),
    // These routes never read the actor ref, so the cast spares the test
    // booting a workspace machine it would not use.
    workspaceRef: undefined as unknown as WorkspaceRPCContext["workspaceRef"],
  };
}

// A workspace of its own for each test, and this computer's folder for it,
// where the folder rules are kept.
beforeEach(() => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "permissions-route-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(rootDir),
    workspaceMachineDir: AbsolutePathSchema.parse(`${rootDir}-machine`),
  });
});

it("sets a place, not a folder, for a folder that is a place on its own", async () => {
  await call(
    permissions.setFolder,
    {
      level: "allow",
      path: AbsolutePathSchema.parse(path.join(os.homedir(), "Documents")),
    },
    { context: createContext() },
  );
  const settings = await readPermissionSettings();
  expect(settings.places.documents).toBe("allow");
  expect(settings.folders).toEqual([]);
});

it("keeps a folder rule for a folder inside a place", async () => {
  const folder = AbsolutePathSchema.parse(
    path.join(os.homedir(), "Documents", "Taxes"),
  );
  await call(
    permissions.setFolder,
    { level: "allow", path: folder },
    { context: createContext() },
  );
  const settings = await readPermissionSettings();
  expect(settings.places.documents).toBeUndefined();
  expect(settings.folders.map((f) => f.path)).toEqual([folder]);
});

describe("permissions.answer", () => {
  const sent: {
    type: string;
    value: { message?: SessionMessage.UserWithParts; sessionId?: string };
  }[] = [];
  const context = () => ({
    workspaceConfig: getWorkspaceConfig(),
    // A wake reads only `send`, which hands a session its note, so the cast
    // spares the test a workspace machine.
    workspaceRef: {
      send: (event: (typeof sent)[number]) => {
        sent.push(event);
      },
    } as unknown as WorkspaceActorRef,
  });

  /** Each session woken since the `before`th event, with the answer it got. */
  function wokenSince(before: number) {
    return sent
      .slice(before)
      .filter((event) => event.type === "addMessage")
      .map((event) => ({
        answer: event.value.message?.parts.flatMap((part) =>
          part.type === "data-permissionAnswer" ? [part.data.answer] : [],
        ),
        sessionId: event.value.sessionId,
      }));
  }

  /** A chat someone has written in, with one task. */
  async function chatWithTask() {
    const chatId = chatFor(StoreId.newSessionId());
    const written = await updateChatSettings(chatId, {
      modelURI: AIGatewayModelURI.Schema.parse(
        "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
      ),
    });
    if (written.isErr()) {
      throw written.error;
    }
    const own = sessionOfChat(chatId);
    if (!own) {
      throw new Error("expected the chat's session");
    }
    const task = await chatTaskFor(chatId, { title: "Stock the pantry" });
    return { chatId, own, task };
  }

  it("wakes every session that asked on the card", async () => {
    const { chatId, own, task } = await chatWithTask();
    await recordAsk({ chatId, sessionId: task }, "folder", "/Users/me/Pantry");
    await recordAsk({ chatId, sessionId: own }, "folder", "/Users/me/Pantry");
    const cards = await openAsks(chatId);
    expect(cards).toHaveLength(1);
    const sentBefore = sent.length;

    await call(
      permissions.answer,
      { askId: cards[0]?.id ?? "", decision: "allowed", id: chatId },
      { context: context() },
    );

    const woken = wokenSince(sentBefore);
    expect(woken).toHaveLength(2);
    expect(woken).toEqual(
      expect.arrayContaining([
        { answer: ["allowed"], sessionId: own },
        { answer: ["allowed"], sessionId: task },
      ]),
    );
    expect(await openAsks(chatId)).toEqual([]);
  });

  // "Not now" is the chat's, whoever asked: one denial, and every asker
  // hears it.
  it("records one denial for the chat when the person says not now to a card two sessions asked on", async () => {
    const { chatId, own, task } = await chatWithTask();
    await recordAsk({ chatId, sessionId: task }, "folder", "/Users/me/Pantry");
    await recordAsk({ chatId, sessionId: own }, "folder", "/Users/me/Pantry");
    const [card] = await openAsks(chatId);
    const sentBefore = sent.length;

    await call(
      permissions.answer,
      { askId: card?.id ?? "", decision: "declined", id: chatId },
      { context: context() },
    );

    expect(await chatDenials(chatId)).toEqual([
      {
        deniedAt: expect.any(Date),
        kind: "folder",
        target: "/Users/me/Pantry",
      },
    ]);
    const woken = wokenSince(sentBefore);
    expect(woken).toHaveLength(2);
    expect(woken).toEqual(
      expect.arrayContaining([
        { answer: ["declined"], sessionId: own },
        { answer: ["declined"], sessionId: task },
      ]),
    );
  });

  // No test for a card written in the old shape. The stored key is `asks`
  // now and its entries carry `askers`, where a card used to carry one
  // `partId` and `sessionId`; nothing reads the old shape, deliberately, so a
  // card left unanswered across the update is asked again rather than
  // migrated. Two installs have one, and asking twice costs less than a shim.

  // The card names an app as its command asked for it, and an Always allow
  // keeps that name, which is how Settings › Permissions lists the app; it
  // then holds in every chat, and "Allow in this chat" in this one only.
  it.each([
    ["Calendar", "com.apple.iCal"],
    ["Reminders", "com.apple.reminders"],
    ["Contacts", "com.apple.AddressBook"],
    ["Mail", "com.apple.mail"],
    ["Notes", "com.apple.Notes"],
    ["Messages", "com.apple.MobileSMS"],
  ])(
    "lists %s in Settings by the card's name once allowed always",
    async (name, bundleId) => {
      const app = { bundleId, name };
      const here = await chatWithTask();
      const elsewhere = await chatWithTask();
      await recordAsk(
        { chatId: here.chatId, sessionId: here.own },
        "app",
        name,
      );
      const [card] = await openAsks(here.chatId);

      await call(
        permissions.answer,
        { askId: card?.id ?? "", decision: "always", id: here.chatId },
        { context: context() },
      );

      expect((await readPermissionSettings()).apps).toEqual([
        expect.objectContaining({ level: "allow", name }),
      ]);
      expect(await appRefusal(here.chatId, app, undefined)).toBeUndefined();
      expect(
        await appRefusal(elsewhere.chatId, app, undefined),
      ).toBeUndefined();
    },
  );

  it("allows an app in the asking chat only, without listing it in Settings", async () => {
    const app = { bundleId: "com.apple.AddressBook", name: "Contacts" };
    const here = await chatWithTask();
    const elsewhere = await chatWithTask();
    await recordAsk(
      { chatId: here.chatId, sessionId: here.own },
      "app",
      "Contacts",
    );
    const [card] = await openAsks(here.chatId);

    await call(
      permissions.answer,
      { askId: card?.id ?? "", decision: "allowed", id: here.chatId },
      { context: context() },
    );

    expect((await readPermissionSettings()).apps).toEqual([]);
    expect(await appRefusal(here.chatId, app, undefined)).toBeUndefined();
    expect(await appRefusal(elsewhere.chatId, app, undefined)).toBe(
      "using Contacts needs the person's yes first.",
    );
  });
});
