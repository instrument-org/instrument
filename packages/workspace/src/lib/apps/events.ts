import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { wakeOrchestrators } from "../orchestrator/wake";
import { getWorkspaceConfig } from "../workspace-config";

/**
 * Wakes the orchestrator when the user acts on an app outside the
 * conversation: a sign-in finished in the browser, a key saved on a card, a
 * decline, a disconnect from the app's page. The host app publishes the
 * event; here it becomes a `data-appEvent` part on a text-less user message,
 * the same way a finishing task reaches the orchestrator, so the agent learns
 * without anyone typing and answers on a turn of its own.
 */
export function startAppEvents(workspaceRef: WorkspaceActorRef): void {
  void (async () => {
    for await (const event of publisher.subscribe("app.event")) {
      try {
        await wakeOrchestrators(
          { data: { events: [event] }, type: "data-appEvent" },
          workspaceRef,
        );
      } catch (error) {
        getWorkspaceConfig().captureException(error);
      }
    }
  })();
}
