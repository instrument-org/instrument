import { useRelativeTime } from "@/client/hooks/use-relative-time";
import { rpcClient } from "@/client/rpc/client";
import { type Task } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

export function TaskStatsCard({ task }: { task: Task }) {
  const { data: messageCount } = useQuery(
    rpcClient.workspace.message.count.queryOptions({
      input: { id: task.id },
    }),
  );

  // The hook rather than the element, since this line is joined into one
  // sentence rather than rendered on its own.
  const updated = useRelativeTime(task.updatedAt);

  const meta = [
    `Created ${format(task.createdAt, "MMM d, yyyy")}`,
    `Updated ${updated}`,
    messageCount !== undefined && messageCount > 0
      ? `${messageCount} ${messageCount === 1 ? "message" : "messages"}`
      : null,
  ].filter(Boolean);

  return (
    <div className="overflow-hidden rounded-lg border bg-muted/50 px-4 py-3">
      <div className="truncate font-medium text-foreground">{task.title}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">
        {meta.join(" · ")}
      </div>
    </div>
  );
}
