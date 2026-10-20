import { type WorkspaceActorRef } from "../../src/machines/workspace";
import { type ChatId } from "../../src/schemas/chat-id";
import { type StoreId } from "../../src/schemas/store-id";

/**
 * The event the agent's chunk timeout raises on itself once a request has
 * gone quiet for `llmRequestChunkTimeoutMs`: XState's name for the delayed
 * transition out of `LLMStreaming.Streaming`.
 */
const CHUNK_TIMEOUT_EVENT =
  "xstate.after.llmRequestChunkTimeoutMs.agent.LLMStreaming.Streaming";

const POLL_MS = 50;

/**
 * Has every model request a task's running turn makes go past its chunk
 * timeout, as a provider that stops answering would, until the retries run
 * out and the turn ends. The real timeout is minutes long, so this fires the
 * agent's own timeout transition the moment each request is in flight: the
 * request is let go, retried, and stored, the way the clock would have done
 * it. Resolves once the turn's agent is gone, or at `deadline`.
 */
export async function timeOutTaskTurn(
  workspaceRef: WorkspaceActorRef,
  { chatId, sessionId }: { chatId: ChatId; sessionId: StoreId.Session },
  deadline: number,
): Promise<{ timeouts: number }> {
  let timeouts = 0;
  let seen = false;
  while (Date.now() < deadline) {
    const session = workspaceRef
      .getSnapshot()
      .context.sessionRefsByChatId.get(chatId)
      ?.find(
        (ref) =>
          ref.getSnapshot().context.sessionId === sessionId &&
          ref.getSnapshot().status === "active",
      );
    const agent = session?.getSnapshot().context.agentRef;
    const live = agent?.getSnapshot().status === "active";
    if (!live) {
      if (seen) {
        break;
      }
    } else {
      seen = true;
      if (agent.getSnapshot().matches({ LLMStreaming: "Streaming" })) {
        timeouts += 1;
        // Typed by the machine as its own; sent from outside, it takes the
        // same transition the clock would have.
        agent.send({ type: CHUNK_TIMEOUT_EVENT } as never);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return { timeouts };
}
