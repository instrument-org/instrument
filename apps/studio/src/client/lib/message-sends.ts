import { rpcClient } from "@/client/rpc/client";
import { type StoreId } from "@instrument-org/workspace/client";
import { noop } from "radashi";

type CreateMessageInput = Parameters<
  typeof rpcClient.workspace.message.create.call
>[0];

/**
 * Each new chat's opening message while it is on its way, by session. A
 * chat's window opens the moment its draft is sent, before the opening
 * message has even left (gathering what the draft was opened over can take
 * seconds), so a message sent from that window would otherwise reach the
 * workspace first and be stored, and answered, ahead of the one it follows.
 */
const openings = new Map<string, Promise<void>>();

/**
 * Message options that send a chat's message only once its opening message
 * has gone through, whichever way that went. For every send into an existing
 * chat; the opening send itself uses the plain options.
 */
export function createMessageOptions(
  options?: Parameters<
    typeof rpcClient.workspace.message.create.mutationOptions
  >[0],
) {
  return {
    ...rpcClient.workspace.message.create.mutationOptions(options),
    mutationFn: async (input: CreateMessageInput) => {
      if (input.sessionId) {
        await openings.get(input.sessionId);
      }
      return rpcClient.workspace.message.create.call(input);
    },
  };
}

/**
 * Holds every other send into a chat until its opening message settles. The
 * returned function settles it, and is called however the opening ends.
 */
export function holdSendsUntilOpened(sessionId: StoreId.Session): () => void {
  let settle: () => void = noop;
  const opening = new Promise<void>((resolve) => {
    settle = resolve;
  });
  openings.set(sessionId, opening);
  return () => {
    settle();
    if (openings.get(sessionId) === opening) {
      openings.delete(sessionId);
    }
  };
}
