import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { createMockChatConfig } from "../../test/helpers/mock-chat-config";
import { asksWritten, closeAsk, openAsks } from "./asks";
import { preflightCommand } from "./preflight";
import { rulesFor } from "./rules";

const settings = { apps: [], folders: [], places: {}, withoutAsking: false };

it("asks before a command that names a folder that asks first, once per folder", async () => {
  const chatId = createMockChatConfig(ChatIdSchema.parse("asks-test"));
  const sessionId = StoreId.newSessionId();
  const partId = StoreId.newPartId();
  const home = os.homedir();
  const waiting = await preflightCommand({
    chatId,
    command: `cat ~/Documents/Clients/a.pdf ~/Documents/Clients/b.pdf && ls ${home}/code`,
    cwd: path.join(os.tmpdir(), "asks-test"),
    partId,
    rules: rulesFor({ home, settings }),
    sessionId,
  });
  await asksWritten();
  expect(waiting).toMatch(
    /^Nothing ran\. Waiting on the person to allow ~\/Documents\/Clients\./,
  );
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
