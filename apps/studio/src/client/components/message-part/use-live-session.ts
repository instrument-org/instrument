import { rpcClient } from "@/client/rpc/client";
import { type StoreId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";

/**
 * Whether a session still has an agent in it.
 *
 * A card that asks the user something offers its buttons while the call sits
 * unanswered, and that is how the call is left on disk too. An app that stopped
 * mid-turn -- an update installing itself, a crash, a quit -- leaves one there
 * for good, with nothing at the other end to take the answer: the click does
 * whatever it does on the way (a folder really is attached) and the
 * conversation never moves. The session is what would take the answer, so
 * whether one is running is the question a card has to ask before offering to
 * answer.
 *
 * Answers yes until the stream says otherwise, so a card is never dead on
 * arrival for as long as the subscription takes to open.
 */
export function useHasLiveSession(sessionId: StoreId.Session) {
  const { data } = useQuery({
    ...rpcClient.workspace.task.live.activity.experimental_liveOptions(),
    select: (entries) =>
      entries.some((entry) =>
        entry.sessionActors.some((actor) => actor.sessionId === sessionId),
      ),
  });
  return data ?? true;
}
