import { rpcClient } from "@/client/rpc/client";
import { type StoreId, type ChatId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";

import { Skeleton } from "../ui/skeleton";
import { UsageStatsTooltip, UsageSummaryText } from "../usage-stats-tooltip";

/**
 * A task's messages and tokens, for a developer reading the task header: its
 * own session's, in the chat's record it runs in. Live, so a running task's
 * totals climb as it streams; the tooltip breaks the tokens down and adds the
 * time spent.
 */
export function TaskUsageSummary({
  sessionId,
  taskId,
}: {
  sessionId: StoreId.Session;
  taskId: ChatId;
}) {
  const { data } = useQuery(
    rpcClient.workspace.task.live.usageSummary.experimental_liveOptions({
      input: { id: taskId, sessionId },
    }),
  );

  return (
    <div className="flex min-w-0 items-center gap-2 text-[10px] text-dev-700/60 dark:text-dev-300/60">
      {data ? (
        <UsageStatsTooltip
          messageCount={data.messageCount}
          stats={{
            activeDuration: data.activeMs,
            generationDuration: data.msToFinish,
            inputTokenDetails: data.inputTokenDetails,
            inputTokens: data.inputTokens,
            outputTokenDetails: data.outputTokenDetails,
            outputTokens: data.outputTokens,
            totalTokens: data.totalTokens,
          }}
        >
          <UsageSummaryText
            className="min-w-0 truncate text-[10px] hover:text-dev-700 dark:hover:text-dev-300"
            messageCount={data.messageCount}
            totalTokens={data.totalTokens}
          />
        </UsageStatsTooltip>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          <Skeleton className="h-3 w-8 rounded-sm bg-dev-700/20 dark:bg-dev-300/20" />
          <Skeleton className="h-3 w-10 rounded-sm bg-dev-700/20 dark:bg-dev-300/20" />
        </div>
      )}
    </div>
  );
}
