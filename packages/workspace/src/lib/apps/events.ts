import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { chatOfApp } from "../chat/attribution";
import { wakeChatForApp } from "../chat/wake";
import { getWorkspaceConfig } from "../workspace-config";

/**
 * Wakes the chat that asked for an app when the user answers the ask
 * outside the conversation: a sign-in finished in the browser, a key saved
 * on a card, a decline, a failure. The host app publishes the event; here it
 * becomes a `data-appEvent` part on a text-less user message, the same way a
 * finishing task reaches the chat, so the agent learns without anyone typing
 * and answers on a turn of its own.
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
        await wakeChatForApp(
          { data: { events: [event] }, type: "data-appEvent" },
          workspaceRef,
          await chatOfApp({ slug: event.slug }),
        );
      } catch (error) {
        getWorkspaceConfig().captureException(error);
      }
    }
  })();
}
