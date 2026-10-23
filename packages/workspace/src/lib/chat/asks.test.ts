import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { cardLine, closeAsk, recordAsk } from "./asks";
import { openAsks } from "./open-asks";
import { ruleRefusal } from "../permissions/rules-fs";
import { rulesFor } from "../permissions/rules";

const settings = {
  apps: [],
  chats: {},
  topics: {},
  folders: [],
  places: {},
  dangerouslyAllowEveryFolder: false,
};

it("names the folder to ask for, and raises no card itself", async () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("asks-test"));
  const home = os.homedir();
  const rules = {
    ...rulesFor({ home, settings }),
    asker: { chatId, sessionId: StoreId.newSessionId() },
  };
  const refusal = ruleRefusal({
    hostPath: path.join(home, "Documents", "Clients", "a.pdf"),
    op: "read",
    rules,
    spell: (hostPath) =>
      `~/${path.relative(home, hostPath).replaceAll(path.sep, "/")}`,
  });
  expect(refusal).toMatchInlineSnapshot(
    `""~/Documents/Clients/a.pdf" needs the person's yes. If the work needs it, ask for "~/Documents/Clients" with ask_permission."`,
  );
  expect(await openAsks(chatId)).toEqual([]);
});

it("asks once per folder, and a second session joins the card", async () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("asks-join-test"));
  const first = StoreId.newSessionId();
  const second = StoreId.newSessionId();
  const target = path.join(os.homedir(), "Desktop");
  await recordAsk(
    { chatId, reason: "To copy it.", sessionId: first },
    "folder",
    target,
  );
  await recordAsk(
    { chatId, reason: "Again.", sessionId: first },
    "folder",
    target,
  );
  await recordAsk(
    { chatId, reason: "To read it.", sessionId: second },
    "folder",
    target,
  );
  const asks = await openAsks(chatId);
  expect(asks).toEqual([
    expect.objectContaining({
      askers: [
        { reason: "To copy it.", sessionId: first },
        { reason: "To read it.", sessionId: second },
      ],
      kind: "folder",
      status: "open",
      target,
    }),
  ]);
  expect(await closeAsk(chatId, asks[0]?.id ?? "")).toBeDefined();
  expect(await openAsks(chatId)).toEqual([]);
});

it("stops counting a session as waiting once it asks with a call that ends its turn", async () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("asks-waits-test"));
  const own = StoreId.newSessionId();
  const target = path.join(os.homedir(), "Downloads");
  const macos = { allowed: "allowed", status: "macos-asking" } as const;
  await recordAsk(
    { chatId, sessionId: own, waits: true },
    "folder",
    target,
    macos,
  );
  expect((await openAsks(chatId))[0]?.askers).toEqual([
    { sessionId: own, waits: true },
  ]);
  // Its command's watch again: still waiting.
  await recordAsk(
    { chatId, sessionId: own, waits: true },
    "folder",
    target,
    macos,
  );
  expect((await openAsks(chatId))[0]?.askers).toEqual([
    { sessionId: own, waits: true },
  ]);
  await recordAsk(
    { chatId, reason: "To list it.", sessionId: own },
    "folder",
    target,
    macos,
  );
  expect((await openAsks(chatId))[0]?.askers).toEqual([
    { reason: "To list it.", sessionId: own },
  ]);
});

it("never asks for the home folder whole", () => {
  const home = os.homedir();
  const refusal = ruleRefusal({
    hostPath: path.join(home, "notes.md"),
    op: "write",
    rules: {
      ...rulesFor({ home, settings }),
      asker: {
        chatId: ChatIdSchema.parse("asks-test"),
        sessionId: StoreId.newSessionId(),
      },
    },
    spell: (hostPath) => hostPath,
  });
  expect(refusal).toMatch(/which can't be asked for whole\./);
});

it.each([
  [
    "folder",
    path.join(os.homedir(), "Pantry"),
    "Waiting for your OK to use “Pantry”",
  ],
  ["app", "Reminders", "Waiting for your OK to use Reminders"],
] as const)("names the %s a card waits on", (kind, target, line) => {
  expect(
    cardLine({
      askedAt: new Date(),
      askers: [],
      id: "ask",
      kind,
      status: "open",
      target,
    }),
  ).toBe(line);
});
