import { type ChatId } from "../schemas/chat-id";
import { type Session } from "../schemas/session";
import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import {
  applyContextRollover,
  contextRolloverBoundaryInForce,
} from "./apply-context-rollover";
import { ChatReads } from "./chat-reads";

/**
 * The conversation this session's model is sent, the baseline in front of it
 * aside: the request is built from it, and anything asking whether the model
 * already has something in front of it (a guide handed over with a command's
 * output) reads the same answer. The session's stored rollover boundary, which
 * a task inherits from its chat, applies while it binds the window of `usable`
 * tokens, so a model with room for more is counted as seeing more.
 */
export function modelWindow({
  messages,
  session,
  usable,
}: {
  messages: readonly SessionMessage.WithParts[];
  session:
    | Pick<
        Session.Type,
        "rolledOverAfterMessageId" | "rolledOverUnderUsableTokens"
      >
    | undefined;
  /** What the model being asked may use, from `usableContextTokens`. */
  usable: number | undefined;
}): {
  /** The boundary in force: the last message before what is sent whole. */
  after: StoreId.Message | undefined;
  messages: SessionMessage.WithParts[];
} {
  const after = contextRolloverBoundaryInForce({
    rolledOverAfterMessageId: session?.rolledOverAfterMessageId,
    rolledOverUnderUsableTokens: session?.rolledOverUnderUsableTokens,
    usable,
  });
  return {
    after,
    messages: applyContextRollover({
      messages,
      rolledOverAfterMessageId: after,
    }),
  };
}

/**
 * {@link modelWindow} read from the chat's records, as stored: for a check
 * made outside the request, such as a command deciding whether to hand over
 * a guide. Undefined where the history cannot be read.
 */
export async function readModelWindow({
  chatId,
  sessionId,
  usable,
}: {
  chatId: ChatId;
  sessionId: StoreId.Session;
  usable: number | undefined;
}): Promise<SessionMessage.WithParts[] | undefined> {
  const [history, session] = await Promise.all([
    ChatReads.history({ chatId, sessionId }),
    ChatReads.session({ chatId, sessionId }),
  ]);
  if (history.isErr()) {
    return undefined;
  }
  return modelWindow({
    messages: history.value.filter(
      (message) => message.role !== "session-context",
    ),
    session: session.isOk() ? session.value : undefined,
    usable,
  }).messages;
}
