import { useOpenGestures } from "@/client/hooks/use-open-target";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { TaskIdSchema } from "@instrument-org/workspace/client";
import { ArrowUpRightIcon } from "@phosphor-icons/react/ArrowUpRight";
import { useQuery } from "@tanstack/react-query";
import ms from "ms";
import { type MouseEvent } from "react";

import { PlanningDotIcon } from "../icons/planning-dot";
import { TRANSCRIPT_ROW } from "../message-part/transcript-group";
import { useOrchestrator } from "./context";

/** How often the row re-reads where the task stands while it works. */
const REFRESH_MS = ms("2 seconds");

/**
 * The task a command in the conversation created, inside the reply that
 * created it, drawn the way a tool call is drawn in the transcript: one row,
 * the task's name and then the step it is on, in the live shimmer while it
 * works, and the name and how it ended in the shut row's muted tone once it
 * is done, with nothing in front of it. What the row says is only what the
 * task says now; nothing about earlier steps is kept. A task that failed or
 * stopped to ask says so in its line's tone rather than with a mark. A press
 * opens the task's own page in the tab on screen, and a middle or modified
 * click puts it in a tab of its own; the way out shows on hover where a tool
 * row keeps its chevron.
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
  // The line a finished task ends on: what it made, what it asks for, or how
  // it stopped. Read from the list of every task the conversation started, and
  // only once this one is done, which is the moment the line is settled.
  const children = useQuery(
    rpcClient.workspace.orchestrator.children.queryOptions({
      enabled: status.data?.isWorking === false,
      input: { id: orchestrator.taskId },
    }),
  );
  const standing = children.data?.find((child) => child.id === id)?.standing;

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
  const isWorking = status.data?.isWorking !== false;
  const line = isWorking ? status.data?.step : standing?.line;
  // The line is in the warning tone when the task did not get to the end of
  // its work: it failed, it was stopped, or it is waiting on the user.
  const needsAttention =
    !isWorking && (standing?.kind === "failed" || standing?.kind === "waiting");

  return (
    // `mt-2` on top of the reply's own 8px gap is the boundary the transcript
    // puts between a paragraph and a step under it. Inline, as a tool call's
    // row is: the row ends where its words do, and the arrow follows them.
    <button
      className={cn(TRANSCRIPT_ROW, "mt-2 inline-flex max-w-full text-left")}
      onAuxClick={gestures.onAuxClick}
      onClick={open}
      onContextMenu={gestures.onContextMenu}
      title={line}
      type="button"
    >
      {/* The live dot while it works; once it is done the name starts the
          row, with nothing in front of it. */}
      {isWorking && <PlanningDotIcon />}
      <span
        className={cn(
          "min-w-0 truncate text-sm",
          isWorking
            ? "brand-shiny-text"
            : "text-muted-foreground group-hover/run-row:text-foreground",
        )}
      >
        <span className={isWorking ? undefined : "text-foreground"}>
          {title}
        </span>
        {line ? (
          <>
            {" · "}
            <span
              className={
                needsAttention
                  ? "text-warning-700 dark:text-warning-300"
                  : undefined
              }
            >
              {line}
            </span>
          </>
        ) : null}
      </span>
      {/* Where the tool call's row keeps its chevron, and shown the same way:
          faded rather than absent, so the row is one width whether or not it
          is hovered. */}
      <ArrowUpRightIcon className="-ml-1 size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-200 group-hover/run-row:opacity-100 group-focus-visible/run-row:opacity-100" />
    </button>
  );
}
