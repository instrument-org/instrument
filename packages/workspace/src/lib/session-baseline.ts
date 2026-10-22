import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import { err, ok, Result } from "neverthrow";
import { alphabetical } from "radashi";

import { type AnyAgent } from "../agents/types";
import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { ChatWrites } from "./chat-writes";

/**
 * A session's baseline is its system prompt and context message: the front of
 * every request it sends, and so the bytes a provider's cache is keyed on.
 *
 * It is written once and then read back verbatim. Whatever changes after it
 * reaches the model as a note on the message where the change was seen (a new
 * day, another computer, a folder granted), never as an edit to it. It is
 * written again only when:
 *
 * - the session has none yet;
 * - a build bumps `SESSION_CONTEXT_VERSION`, for a change old chats must hear
 *   before their next rollover;
 * - the session's window rolled over past it. The rollover already rewrites
 *   the front of the request, so this costs nothing extra, and it is where a
 *   release's new system prompt reaches a chat that began on an older one.
 *
 * A system prompt that differs from the stored one is never a reason on its
 * own: an app update and a chat moving to another computer both look like
 * that, and rewriting on either would rewrite every synced chat each time it
 * changed hands.
 */

/**
 * Which shape of baseline this build writes. Bump it only when what
 * `agent.getMessages` writes has to reach chats before their next rollover:
 * each one writes its baseline again, once, on its next turn.
 *
 * A baseline marked older (or not at all, from before the marker existed) is
 * written again; one marked newer is kept, since an older build running
 * against a newer baseline has nothing better to put there.
 */
export const SESSION_CONTEXT_VERSION = 45;

/** Why a session's baseline has to be written now. */
type Due = "none" | "older-shape" | "rolled-over";

/**
 * The baseline a session's requests start with, oldest message first: its
 * own once it has written one, else the one it inherited from the chat it was
 * forked from.
 */
export function baselineInForce(
  contextMessages: SessionMessage.ContextWithParts[],
  sessionId: StoreId.Session,
): SessionMessage.ContextWithParts[] {
  const own = contextMessages.filter(
    (message) => message.metadata.sessionId === sessionId,
  );
  // ulid sorts oldest to newest.
  return alphabetical(
    own.length > 0 ? own : contextMessages,
    (message) => message.id,
  );
}

/**
 * Why `baseline` has to be written again, or undefined while it stands.
 *
 * @param rolledOverAfterMessageId The boundary of the session's window in
 * force for this request, if it has rolled over.
 */
function baselineDue({
  baseline,
  rolledOverAfterMessageId,
}: {
  baseline: SessionMessage.ContextWithParts[];
  rolledOverAfterMessageId: StoreId.Message | undefined;
}): Due | undefined {
  const newest = baseline.at(-1);
  if (newest === undefined) {
    return "none";
  }
  if (
    baseline.some(
      (message) =>
        (message.metadata.contextVersion ?? 0) < SESSION_CONTEXT_VERSION,
    )
  ) {
    return "older-shape";
  }
  if (
    rolledOverAfterMessageId !== undefined &&
    newest.id < rolledOverAfterMessageId
  ) {
    return "rolled-over";
  }
  return undefined;
}

/**
 * The baseline this request starts with: the one in force, or a new one
 * written when `baselineDue` says so. A new one replaces the session's own
 * rather than joining it, since two baselines in the store are two in every
 * later request; one it inherited stays with the chat it belongs to.
 */
export async function sessionBaseline({
  agent,
  chatId,
  contextMessages,
  model,
  rolledOverAfterMessageId,
  sessionId,
}: {
  agent: AnyAgent;
  chatId: ChatId;
  contextMessages: SessionMessage.ContextWithParts[];
  model: AIGatewayModel.Type;
  rolledOverAfterMessageId: StoreId.Message | undefined;
  sessionId: StoreId.Session;
}) {
  const baseline = baselineInForce(contextMessages, sessionId);
  if (baselineDue({ baseline, rolledOverAfterMessageId }) === undefined) {
    return ok(baseline);
  }

  // Together, so no reader finds a session between two baselines.
  const replaced = baseline
    .filter((stored) => stored.metadata.sessionId === sessionId)
    .map((stored) => stored.id);
  if (replaced.length > 0) {
    const removed = await ChatWrites.retract(chatId, sessionId, replaced);
    if (removed.isErr()) {
      return err(removed.error);
    }
  }

  const written = (await agent.getMessages({ chatId, model, sessionId })).map(
    (message) => ({
      ...message,
      metadata: {
        ...message.metadata,
        contextVersion: SESSION_CONTEXT_VERSION,
      },
    }),
  );
  const saved = Result.combine(
    await Promise.all(
      written.map((message) =>
        ChatWrites.saveMessageWithParts(message, chatId),
      ),
    ),
  );
  if (saved.isErr()) {
    return err(saved.error);
  }
  return ok(written);
}
