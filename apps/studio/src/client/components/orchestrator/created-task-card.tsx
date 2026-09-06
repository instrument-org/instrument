import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import ms from "ms";

/** How often the card re-reads where the task stands. */
const REFRESH_MS = ms("2 seconds");

/**
 * The task a command in the conversation created, drawn under that command
 * as a card that follows it: what it is called, what it is doing this moment
 * while it works, when it finished once it has, and a way into its own
 * transcript. The conversation's view of the work it handed off.
 */
export function CreatedTaskCard({ taskId }: { taskId: string }) {
  const navigate = useNavigate();
  const id = TaskIdSchema.parse(taskId);
  const status = useQuery(
    rpcClient.workspace.orchestrator.childStatus.queryOptions({
      input: { id },
      refetchInterval: (query) =>
        query.state.data?.isWorking === false ? false : REFRESH_MS,
    }),
  );
  const standing = status.data;
  return (
    <button
      className={cn(
        "mt-1.5 flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm hover:bg-accent/50",
      )}
      onClick={() => {
        void navigate({ params: { id }, to: "/orchestrator/tasks/$id" });
      }}
      type="button"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          {standing?.title ?? "Task"}
        </span>
        <span
          className={cn(
            "block truncate text-xs",
            standing?.isWorking ? "brand-shiny-text" : "text-muted-foreground",
          )}
        >
          {standing
            ? standing.isWorking
              ? (standing.step ?? "Working")
              : `Done · ${ago(standing.updatedAt)}`
            : "Starting"}
        </span>
      </span>
      <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function ago(at: number) {
  const elapsed = Date.now() - at;
  return elapsed < ms("1 minute")
    ? "just now"
    : `${ms(elapsed, { long: true })} ago`;
}
