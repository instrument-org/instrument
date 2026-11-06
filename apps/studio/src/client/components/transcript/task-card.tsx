import { cn } from "@/client/lib/utils";
import {
  slotOf,
  type StoreId,
  turnsOf,
} from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { StopIcon } from "@phosphor-icons/react/Stop";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { use } from "react";

import { ShimmerSweep } from "../shimmer-sweep";
import { Badges } from "./activity-row";
import { RollingText } from "./rolling-text";
import { SlotCardView } from "./slot-card";
import { TranscriptSurfaceContext } from "./surface";
import { formatRoughSpan, useTicking } from "./time";

/** The dots after a working task's step. */
function WorkingDots() {
  return (
    <span aria-hidden className="flex shrink-0 items-center gap-0.5">
      {[0, 200, 400].map((delay) => (
        <span
          className="size-1 animate-pulse rounded-full bg-current"
          key={delay}
          style={{ animationDelay: `${delay.toString()}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * A task the chat started, where it started it. Two lines, tinted while it
 * works and flat once it has finished, the sites and apps it reached at the
 * right, the task's own Stop on hover, and while it works the task's own live
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
  const span = isWorking ? now - startedAt.getTime() : facts?.ranMs;
  return (
    <div className="flex max-w-130 flex-col gap-2">
      <div
        className={cn(
          "group/task flex items-center gap-2.5 rounded-2xl border px-3.5 py-2.5",
          isWorking
            ? "border-brand-600/40 bg-brand-500/10"
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
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <RollingText className="min-w-0" rollKey={firstLine}>
                <span
                  className={cn(
                    "block min-w-0 truncate text-sm",
                    isWorking ? "brand-shiny-text" : "text-foreground",
                  )}
                >
                  {firstLine}
                  {isWorking && <ShimmerSweep text={firstLine} />}
                </span>
              </RollingText>
              {isWorking ? (
                <span className="brand-shiny-text">
                  <WorkingDots />
                </span>
              ) : facts?.failed ? (
                <WarningIcon className="text-warning-600 size-3.5 shrink-0" />
              ) : (
                <CheckIcon className="size-3.5 shrink-0 text-muted-foreground" />
              )}
            </span>
            <span className="block truncate text-xs text-muted-foreground tabular-nums">
              Task · {title}
              {span !== undefined && ` · ${formatRoughSpan(span)}`}
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
          isCurrent={turn.phase === "working"}
          sessionId={sessionId}
        />
      )}
    </div>
  );
}
