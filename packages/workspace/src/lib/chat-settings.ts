import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { errAsync, type ResultAsync } from "neverthrow";

import { type ChatId } from "../schemas/chat-id";
import { ChatReads } from "./chat-reads";
import { ChatWrites } from "./chat-writes";
import { TypedError } from "./errors";
import { sessionOfChat } from "./record-folders";

/**
 * The model a chat's sessions run on, its tasks' included: the one the
 * composer last sent with, from the `model` setting on the chat's own
 * session. Undefined for a chat nobody has sent a message in yet, and for a
 * URI this build cannot parse (a provider since renamed or removed), so the
 * chat opens on the default model rather than failing to open.
 */
export async function chatModelURI(
  chatId: ChatId,
): Promise<AIGatewayModelURI.Type | undefined> {
  const sessionId = sessionOfChat(chatId);
  if (!sessionId) {
    return undefined;
  }
  const settings = await ChatReads.settings({ chatId, sessionId });
  if (settings.isErr()) {
    return undefined;
  }
  const parsed = AIGatewayModelURI.Schema.safeParse(
    settings.value.model?.value,
  );
  return parsed.success ? parsed.data : undefined;
}

/**
 * Picks the model the chat's sessions run on, in this device's settings
 * file. The same model again writes nothing.
 */
export function setChatModel(
  chatId: ChatId,
  modelURI: AIGatewayModelURI.Type,
): ResultAsync<void, TypedError.NotFound | TypedError.Storage> {
  const sessionId = sessionOfChat(chatId);
  if (!sessionId) {
    return errAsync(
      new TypedError.NotFound(`Chat ${chatId} has no session of its own`),
    );
  }
  return ChatWrites.setting(chatId, sessionId, {
    field: "model",
    value: modelURI,
  });
}
