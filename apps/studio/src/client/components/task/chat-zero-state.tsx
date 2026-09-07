import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { sort } from "radashi";

import { InternalLink } from "../internal-link";

interface ChatZeroStateProps {
  id: TaskId;
  message?: string;
  selectedSessionId?: string;
  /**
   * Whether to offer the task's other sessions. False where a session is not
   * an old chat to return to: the conversation's channels are sessions of one
   * task, and listing them here would offer the user their own channels, and
   * the sessions behind them, as somewhere to go back to.
   */
  showOtherSessions?: boolean;
}

export function ChatZeroState({
  id,
  selectedSessionId,
  showOtherSessions = true,
}: ChatZeroStateProps) {
  const { data: allSessions = [] } = useQuery(
    rpcClient.workspace.session.live.list.experimental_liveOptions({
      input: { id },
    }),
  );

  const recentOtherSessions = !showOtherSessions
    ? []
    : sort(
        allSessions.filter((session) => session.id !== selectedSessionId),
        (s) => (s.updatedAt ?? s.createdAt).getTime(),
        true,
      ).slice(0, 10);

  return (
    <div className="mt-8 flex justify-center">
      <div className="space-y-8 text-center">
        <div className="text-muted-foreground/50">No messages yet</div>
        {recentOtherSessions.length > 0 && (
          <div className="space-y-3 text-xs opacity-50">
            <div>Looking for an old chat?</div>
            <div className="space-y-2">
              {recentOtherSessions.map((session) => (
                <InternalLink
                  allowOpenNewTab={false}
                  className="block text-xs underline hover:text-foreground"
                  key={session.id}
                  params={{ id }}
                  preload="intent"
                  replace
                  search={(prev) => ({
                    ...prev,
                    selectedSessionId: session.id,
                  })}
                  to="/tasks/$id"
                >
                  {session.title || "Untitled chat"}
                </InternalLink>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
