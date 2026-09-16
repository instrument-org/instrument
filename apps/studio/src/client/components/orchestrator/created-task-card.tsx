import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { ArrowUpRightIcon } from "@phosphor-icons/react/ArrowUpRight";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { useQuery } from "@tanstack/react-query";
import ms from "ms";
import { useState } from "react";

import { useOrchestrator } from "./context";

/** How often the card re-reads where the task stands. */
const REFRESH_MS = ms("2 seconds");

/** How many of the task's steps the card keeps on show: the one it is on, and the couple before it. */
const STEPS_SHOWN = 3;

/**
 * The task a command in the conversation created, inside the reply that
 * created it: a snippet of the work rather than a message inside a message.
 *
 * While it runs, a contained card: the task's name in brand, and the last few
 * steps as a small timeline with the current one lit. No avatar, no time. Done,
 * it steps out of the way as one quiet line, a check, the name, and how it
 * ended, which still opens the task. Either way a press opens the task's own
 * page as a tab beside the thread.
 */
export function CreatedTaskCard({ taskId }: { taskId: string }) {
  const orchestrator = useOrchestrator();
  const id = TaskIdSchema.parse(taskId);
  const status = useQuery(
    rpcClient.workspace.orchestrator.childStatus.queryOptions({
      input: { id },
      refetchInterval: (query) =>
        query.state.data?.isWorking === false ? false : REFRESH_MS,
    }),
  );
  // The line a finished task ends on: what it made, what it asks for, or how it
  // stopped. Read from the list of every task the conversation started, and
  // only once this one is done, which is the moment the line is settled.
  const children = useQuery(
    rpcClient.workspace.orchestrator.children.queryOptions({
      enabled: status.data?.isWorking === false,
      input: { id: orchestrator.taskId },
    }),
  );
  const standing = children.data?.find((child) => child.id === id)?.standing;

  // The steps this card has seen the task on, in order: the task reports the
  // one it is on, and the timeline is the trail of those reports.
  const [steps, setSteps] = useState<string[]>([]);
  const step = status.data?.step;
  if (step && step !== steps.at(-1)) {
    setSteps([...steps, step].slice(-STEPS_SHOWN));
  }

  const open = () => {
    orchestrator.openScreen(`/orchestrator/tasks/${id}`, { newTab: true });
  };
  const title = status.data?.title ?? "Task";

  if (status.data && !status.data.isWorking) {
    return (
      <button
        className="mt-1 flex h-6 w-fit max-w-full items-center gap-2 rounded px-1 text-left text-xs hover:bg-foreground/8"
        onClick={open}
        type="button"
      >
        <CheckIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-medium">{title}</span>
        {standing ? (
          <span className="min-w-0 truncate text-muted-foreground">
            {standing.line}
          </span>
        ) : null}
        <ArrowUpRightIcon className="size-3 shrink-0 text-muted-foreground" />
      </button>
    );
  }

  const shown = steps.length > 0 ? steps : ["Starting"];
  return (
    <button
      className="mt-1.5 flex w-full flex-col rounded-lg border border-border bg-card px-3 pt-2 pb-1 text-left hover:bg-accent/50"
      onClick={open}
      type="button"
    >
      <span className="flex w-full items-center gap-2 pb-2 text-xs font-medium text-brand-600 dark:text-brand-400">
        <span className="min-w-0 truncate">{title}</span>
        <span className="flex-1" />
        <ArrowUpRightIcon className="size-3 shrink-0 text-muted-foreground" />
      </span>
      {shown.map((line, index) => {
        const isCurrent = index === shown.length - 1;
        return (
          <span className="flex w-full gap-2.5" key={`${index}:${line}`}>
            {/* The dot and the line down to the next: the trail of steps, the current one lit. */}
            <span className="flex w-3 shrink-0 flex-col items-center">
              <span
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full",
                  isCurrent ? "bg-brand-600 dark:bg-brand-400" : "bg-border",
                )}
              />
              {isCurrent ? null : <span className="w-px flex-1 bg-border" />}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate pb-1.5 text-xs",
                isCurrent ? "brand-shiny-text" : "text-muted-foreground",
              )}
            >
              {line}
            </span>
          </span>
        );
      })}
    </button>
  );
}
