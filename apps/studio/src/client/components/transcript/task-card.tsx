import { cn } from "@/client/lib/utils";
import {
  isSlotBehind,
  slotOf,
  type StoreId,
  turnsOf,
} from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { StopIcon } from "@phosphor-icons/react/Stop";
import { use } from "react";

import { PlanningDotIcon } from "../icons/planning-dot";
import { Badges } from "./activity-row";
import { SlotCardView } from "./slot-card";
import { TranscriptSurfaceContext } from "./surface";
import { formatClock, useTicking } from "./time";

/**
 * A task the chat started, where it started it. Two lines, the mark at the
 * left and the task's own Stop on hover, and while it works the task's own live
 * card, since a chat's visual work is mostly its tasks'. It never folds.
 */
export function TaskCardRow({
  sessionId,
  startedAt,
}: {
  sessionId: StoreId.Session;
  startedAt: Date;
}) {
  const surface = use(TranscriptSurfaceContext);
  const facts = surface?.useTaskFacts(sessionId);
  const isWorking = facts?.working !== false;
  const messages = surface?.useTaskMessages(sessionId, isWorking) ?? [];
  const now = useTicking(isWorking);
  const turn = isWorking
    ? turnsOf(messages, { isRunning: true, sessionId }).at(-1)
    : undefined;
  const card = turn && slotOf(turn);
  const title = facts?.title ?? "Task";
  const firstLine = isWorking
    ? (facts?.step ?? "Starting")
    : (facts?.ended ?? title);
  return (
    <div className="flex max-w-100 flex-col gap-2">
      <div
        className={cn(
          "group/task flex items-center gap-2.5 rounded-2xl border px-3 py-2",
          isWorking
            ? "border-border bg-card"
            : "border-transparent bg-muted/60",
        )}
      >
        <button
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none"
          onClick={() => {
            surface?.onOpenTask(sessionId);
          }}
          type="button"
        >
          <span className="flex size-5 shrink-0 items-center justify-center">
            {isWorking ? (
              <PlanningDotIcon />
            ) : (
              <CheckIcon
                className={cn(
                  "size-3.5",
                  facts?.failed ? "text-warning-600" : "text-muted-foreground",
                )}
              />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate text-sm",
                isWorking
                  ? "font-medium text-foreground"
                  : "text-foreground/80",
              )}
            >
              {firstLine}
            </span>
            <span className="block truncate text-xs text-muted-foreground tabular-nums">
              Task · {title}
              {isWorking && ` · ${formatClock(now - startedAt.getTime())}`}
            </span>
          </span>
          {turn && <Badges apps={turn.apps} sites={turn.sites} />}
        </button>
        {facts?.stoppable && (
          <button
            aria-label="Stop this task"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover/task:opacity-100 hover:bg-muted hover:text-foreground"
            onClick={() => {
              surface?.onStopTask(sessionId);
            }}
            type="button"
          >
            <StopIcon className="size-3.5" weight="fill" />
          </button>
        )}
      </div>
      {card && turn && (
        <SlotCardView
          card={card}
          isCurrent={!isSlotBehind(card, turn)}
          sessionId={sessionId}
        />
      )}
    </div>
  );
}
