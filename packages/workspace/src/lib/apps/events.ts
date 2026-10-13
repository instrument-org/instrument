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
 * The chat woken is the one the app's connection record says asked. An
 * answer that settles the ask (connected, declined) takes the ask off the
 * record, so connecting the app again later from Settings wakes nobody; a
 * failure leaves it, since the user can try again from the same card.
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
        await wakeChatForApp(
          { data: { events: [event] }, type: "data-appEvent" },
          workspaceRef,
          connection?.askedIn,
        );
        if (connection?.askedIn && event.event !== "failed") {
          const { askedIn: _answered, ...rest } = connection;
          await getWorkspaceConfig().apps.connections.set(event.slug, rest);
        }
      } catch (error) {
        getWorkspaceConfig().captureException(error);
      }
    }
  })();
}
