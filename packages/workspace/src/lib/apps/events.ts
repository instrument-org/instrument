import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { wakeChatForApp } from "../chat/wake";
import { getWorkspaceConfig } from "../workspace-config";
import { readConnection } from "./connection";

/**
 * Wakes the chat that asked for an app when the user answers the ask
 * outside the conversation: a sign-in finished in the browser, a key saved
 * on a card, a decline, a failure. The host app publishes the event; here it
 * becomes a `data-appEvent` part on a text-less user message, the same way a
 * finishing task reaches the chat, so the agent learns without anyone typing
 * and answers on a turn of its own.
 *
 * The chats woken are every one the app's connection record says is waiting.
 * An answer that settles the ask (connected, declined) takes them all off the
 * record, since the standing every card draws is the app's and says the same
 * thing in each chat, and connecting the app again later from Settings wakes
 * nobody. A failure leaves them, since the user can try again from any of the
 * cards.
 *
 * A disconnect or a removal is the user putting an app away, not answering
 * anything, so it wakes no chat; each chat hears of it on the next message
 * the user writes there.
 */
export function startAppEvents(workspaceRef: WorkspaceActorRef): void {
  void (async () => {
    for await (const event of publisher.subscribe("app.event")) {
      if (event.event === "disconnected" || event.event === "removed") {
        continue;
      }
      try {
        const connection = await readConnection(event.slug);
        const waiting = connection?.waitingChats ?? [];
        await Promise.all(
          waiting.map((chatId) =>
            wakeChatForApp([event], workspaceRef, chatId),
          ),
        );
        // Read again: a chat may have asked while the others were woken.
        const after = await readConnection(event.slug);
        if (after?.waitingChats && event.event !== "failed") {
          const answered = new Set(waiting);
          const still = after.waitingChats.filter(
            (chatId) => !answered.has(chatId),
          );
          const { waitingChats: _answered, ...rest } = after;
          await getWorkspaceConfig().apps.connections.set(event.slug, {
            ...rest,
            ...(still.length > 0 ? { waitingChats: still } : {}),
          });
        }
      } catch (error) {
        getWorkspaceConfig().captureException(error);
      }
    }
  })();
}
