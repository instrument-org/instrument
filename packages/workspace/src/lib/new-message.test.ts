import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { expect, it } from "vitest";

import { SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { chatFor } from "../test/helpers/chat-record";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { ChatIdSchema } from "../schemas/chat-id";
import { closeAsksOf, recordAsk } from "./chat/asks";
import { newMessage } from "./new-message";

const modelURI = AIGatewayModelURI.Schema.parse(
  "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
);

it("tells the agent a card to run a command as administrator is still up", async () => {
  createMockChatConfig(ChatIdSchema.parse("new-message-test"));
  const sessionId = StoreId.newSessionId();
  const chatId = await chatFor(sessionId);
  const command = "systemsetup -settimezone America/New_York";
  const send = async () => {
    const message = (
      await newMessage({
        chatId,
        modelURI,
        prompt: "What does this do?",
        sessionId,
      })
    )._unsafeUnwrap();
    if (!message || !("role" in message)) throw new Error("expected a message");
    return SessionMessage.toUIMessages([message])
      .flatMap(({ parts }) => parts)
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
  };

  expect(await send()).not.toContain("is still up");
  await recordAsk(
    { chatId, reason: "Changes the time zone.", sessionId },
    "admin",
    command,
  );
  expect(await send()).toContain(
    `The card to run \`${command}\` as an administrator is still up. Answer the user's question; don't ask to run it again.`,
  );
  await closeAsksOf(chatId, undefined);
  expect(await send()).not.toContain("is still up");
});
