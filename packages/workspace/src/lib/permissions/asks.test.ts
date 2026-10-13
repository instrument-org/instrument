import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { asksWritten, closeAsk, openAsks } from "./asks";
import { ruleRefusal } from "./rules-fs";
import { rulesFor } from "./rules";

const settings = { apps: [], folders: [], places: {}, withoutAsking: false };

it("asks once for a folder a call runs into, under that call", async () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("asks-test"));
  const sessionId = StoreId.newSessionId();
  const partId = StoreId.newPartId();
  const home = os.homedir();
  const rules = {
    ...rulesFor({ home, settings }),
    asker: { chatId, partId, sessionId },
  };
  const refuse = (file: string) =>
    ruleRefusal({
      hostPath: path.join(home, "Documents", "Clients", file),
      op: "read",
      rules,
      spell: (hostPath) => hostPath,
    });
  expect(refuse("a.pdf")).toMatch(/^Waiting on the person to allow /);
  refuse("b.pdf");
  await asksWritten();
  const asks = await openAsks(chatId);
  expect(asks).toEqual([
    expect.objectContaining({
      kind: "folder",
      partId,
      sessionId,
      target: path.join(home, "Documents", "Clients"),
    }),
  ]);
  expect(await closeAsk(chatId, asks[0]?.id ?? "")).toBeDefined();
  expect(await openAsks(chatId)).toEqual([]);
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
  expect(refusal).toMatch(/needs the person's yes first\.$/);
});
