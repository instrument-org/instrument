import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type StoreId } from "../../schemas/store-id";
import { ChatReads } from "../chat-reads";
import { isTypedByUser } from "../typed-by-user";
import { getWorkspaceConfig } from "../workspace-config";
import { wakeSessionForSignIn } from "./wake";

/**
 * The sessions whose agent asked for an image nothing connected could make,
 * waiting on the person to sign in to Instrument from the note over their
 * message box. Kept in memory, as an ask that outlives a sign-in started
 * there and then: one left at a relaunch is answered by the person asking
 * again.
 */
const waiting = new Map<
  string,
  { chatId: ChatId; sessionId: StoreId.Session }
>();

/** Marks a session as waiting on a sign-in for the image it asked for. */
export function waitForSignIn(chatId: ChatId, sessionId: StoreId.Session) {
  waiting.set(`${chatId}:${sessionId}`, { chatId, sessionId });
}

/** Says the person signed in to Instrument, which wakes every session waiting on it. */
export function accountSignedIn() {
  publisher.publish("account.signedIn", null);
}

/**
 * Whether a session still waits on a sign-in: its last image request found
 * nothing to make it with, and the person has written nothing since, which
 * would be their answer to whatever was asked.
 */
export function isWaitingOnSignIn(messages: SessionMessage.WithParts[]) {
  for (const message of messages.toReversed()) {
    if (message.role === "user" && isTypedByUser(message)) {
      return false;
    }
    for (const part of message.parts.toReversed()) {
      if (
        part.type === "tool-generate_image" &&
        part.state === "output-available"
      ) {
        return (
          part.output.state === "failure" &&
          part.output.errorType === "no-image-model"
        );
      }
    }
  }
  return false;
}

/**
 * Wakes the sessions waiting on a sign-in once the person signs in, each
 * that still waits (`isWaitingOnSignIn`), so the agent makes the image
 * without being asked again. Every ask is answered by the one sign-in.
 */
export function startSignInWake(workspaceRef: WorkspaceActorRef): void {
  void (async () => {
    for await (const _ of publisher.subscribe("account.signedIn")) {
      const asked = [...waiting.values()];
      waiting.clear();
      await Promise.all(
        asked.map(async ({ chatId, sessionId }) => {
          try {
            const history = await ChatReads.history({ chatId, sessionId });
            if (history.isErr() || !isWaitingOnSignIn(history.value)) {
              return;
            }
            await wakeSessionForSignIn(
              { data: { waitedFor: "image" }, type: "data-signedIn" },
              workspaceRef,
              chatId,
              sessionId,
            );
          } catch (error) {
            getWorkspaceConfig().captureException(error);
          }
        }),
      );
    }
  })();
}
