import { useOpenGestures } from "@/client/hooks/use-open-target";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { ArrowUpRightIcon } from "@phosphor-icons/react/ArrowUpRight";
import { useQuery } from "@tanstack/react-query";
import ms from "ms";
import { type MouseEvent, useState } from "react";

import { TRANSCRIPT_ROW } from "../message-part/transcript-group";
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
 * it steps out of the way and takes the shape of a tool call's shut row in the
 * transcript: the name, then how it ended, as prose in the row's size and
 * weight that wraps rather than cuts, with the way out to the task's page
 * showing on hover where that row's chevron does. No icon at all: a task that
 * failed or stopped to ask says so in its line's tone rather than beside it.
 * Either way a press opens the task's own page in the tab on screen, and a
 * middle or modified click puts it in a tab of its own.
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

  const href = `/orchestrator/tasks/${id}`;
  // A middle click, a modified click, or the menu on a right click asks for a
  // tab of the task's own; a plain click takes the tab on screen.
  const gestures = useOpenGestures({ href, kind: "screen" });
  const open = (event: MouseEvent<HTMLButtonElement>) => {
    if (isMacOS() ? event.metaKey : event.ctrlKey) {
      gestures.separate?.run();
      return;
    }
    orchestrator.openScreen(href);
  };
  const title = status.data?.title ?? "Task";

  if (status.data && !status.data.isWorking) {
    // The line is in the warning tone when the task did not get to the end of
    // its work: it failed, it was stopped, or it is waiting on the user.
    const needsAttention =
      standing?.kind === "failed" || standing?.kind === "waiting";
    return (
      // `mt-2` on top of the reply's own 8px gap is the boundary the transcript
      // puts between a paragraph and a step under it, so the row sits under the
      // reply's words at the distance a tool call sits under the agent's.
      //
      // Inline, as the tool call's row is: a one-line row ends where its text
      // does, so the arrow follows the words, and one that wraps fills the width
      // with the arrow at its first line's end.
      <button
        className={cn(
          TRANSCRIPT_ROW,
          "mt-2 inline-flex max-w-full items-start text-left",
        )}
        onAuxClick={gestures.onAuxClick}
        onClick={open}
        onContextMenu={gestures.onContextMenu}
        type="button"
      >
        <span className="min-w-0 text-sm">
          <span className="text-foreground">{title}</span>
          {standing ? (
            <>
              {" "}
              <span
                className={
                  needsAttention
                    ? "text-warning-700 dark:text-warning-300"
                    : "text-muted-foreground group-hover/run-row:text-foreground"
                }
              >
                {standing.line}
              </span>
            </>
          ) : null}
        </span>
        {/* Where the tool call's row keeps its chevron, and shown the same way:
            faded rather than absent, so the row is one width whether or not it
            is hovered. `mt-1` centers it on the text's first 20px line. */}
        <ArrowUpRightIcon className="mt-1 -ml-1 size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-200 group-hover/run-row:opacity-100 group-focus-visible/run-row:opacity-100" />
      </button>
    );
  }

  const shown = steps.length > 0 ? steps : ["Starting"];
  return (
    <button
      className="mt-1.5 flex w-full flex-col rounded-lg border border-border bg-card px-3 pt-2 pb-1 text-left hover:bg-accent/50"
      onAuxClick={gestures.onAuxClick}
      onClick={open}
      onContextMenu={gestures.onContextMenu}
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
