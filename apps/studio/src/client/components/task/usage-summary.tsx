import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";

import { Skeleton } from "../ui/skeleton";
import { UsageStatsTooltip, UsageSummaryText } from "../usage-stats-tooltip";

export function ProjectUsageSummary({
  id,
  onClick,
}: {
  id: TaskId;
  onClick?: () => void;
}) {
  const { data } = useQuery(
    rpcClient.workspace.task.live.usageSummary.experimental_liveOptions({
      input: { id },
    }),
  );

  return (
    <div className="flex min-w-0 items-center gap-2 text-[10px] text-dev-700/60 dark:text-dev-300/60">
      {data ? (
        <UsageStatsTooltip
          messageCount={data.messageCount}
          stats={{
            inputTokenDetails: data.inputTokenDetails,
            inputTokens: data.inputTokens,
            outputTokenDetails: data.outputTokenDetails,
            outputTokens: data.outputTokens,
            totalDuration: data.msToFinish,
            totalTokens: data.totalTokens,
          }}
        >
          <UsageSummaryText
            className="min-w-0 truncate text-[10px] transition-colors hover:text-dev-700 dark:hover:text-dev-300"
            messageCount={data.messageCount}
            onClick={onClick}
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
