import { cn } from "@/client/lib/utils";
import {
  workCardOf,
  type StoreId,
  turnsOf,
} from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { PauseCircleIcon } from "@phosphor-icons/react/PauseCircle";
import { StopIcon } from "@phosphor-icons/react/Stop";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { AnimatePresence } from "motion/react";
import { type ReactNode, use } from "react";

import { ShimmerSweep } from "../shimmer-sweep";
import { Badges } from "./activity-row";
import { CardPresence, useCardOpens } from "./card-motion";
import { RollingText } from "./rolling-text";
import { WorkCardView } from "./work-card";
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
 * A task the chat started or sent work to, where it did, standing for the
 * stretch of the task's log from there to the next message the chat sent it:
 * only the task's last stretch is ever live. Two lines, tinted while it
 * works and flat once it has finished, the sites and apps it reached after its
 * first line, the task's own Stop on hover, and while it works the task's own live
 * card, since a chat's visual work is mostly its tasks'. It never folds.
 *
 * It comes up as the call that starts the task arrives, before the task
 * exists, as a card that is starting, and the same card carries on once the
 * task's id is known.
 */
export function TaskCardRow({
  from,
  name,
  sessionId,
  startedAt,
}: {
  from?: StoreId.Message;
  name?: string;
  sessionId?: StoreId.Session;
  startedAt: Date;
}) {
  return sessionId === undefined ? (
    <StartingTaskCard name={name} startedAt={startedAt} />
  ) : (
    <LiveTaskCard
      {...(from && { from })}
      sessionId={sessionId}
      startedAt={startedAt}
    />
  );
}

/** The card of a task whose call has not made it yet. */
function StartingTaskCard({
  name,
  startedAt,
}: {
  name?: string;
  startedAt: Date;
}) {
  const now = useTicking(true);
  return (
    <TaskCardFace
      disabled
      firstLine="Starting"
      isWorking
      span={now - startedAt.getTime()}
      title={name ?? "Task"}
    />
  );
}

function LiveTaskCard({
  from,
  sessionId,
  startedAt,
}: {
  from?: StoreId.Message;
  sessionId: StoreId.Session;
  startedAt: Date;
}) {
  const surface = use(TranscriptSurfaceContext);
  const facts = surface?.useTaskFacts(sessionId, from);
  const isWorking = facts?.working !== false;
  const messages = surface?.useTaskMessages(sessionId, isWorking) ?? [];
  const now = useTicking(isWorking);
  const turn = isWorking
    ? turnsOf(messages, { isRunning: true, sessionId }).at(-1)
    : undefined;
  const card = turn && workCardOf(turn);
  const cardOpens = useCardOpens(card !== undefined);
  const title = facts?.title ?? "Task";
  const firstLine = isWorking
    ? (facts?.step ?? "Starting")
    : (facts?.ended ?? title);
  const span = isWorking
    ? now - (facts?.startedAt ?? startedAt).getTime()
    : facts?.ranMs;
  return (
    <TaskCardFace
      badges={turn && <Badges apps={turn.apps} sites={turn.sites} />}
      disabled={facts?.gone === true}
      firstLine={firstLine}
      isWorking={isWorking}
      mark={
        facts?.failed ? (
          <WarningIcon className="text-warning-600 size-3.5 shrink-0" />
        ) : facts?.waiting ? (
          <PauseCircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : facts?.handedOn ? null : (
          <CheckIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )
      }
      onOpen={() => {
        surface?.onOpenTask(sessionId);
      }}
      {...(facts?.stoppable && {
        onStop: () => {
          surface?.onStopTask(sessionId);
        },
      })}
      span={span}
      title={title}
    >
      {/* No words of the task's start below its card, so the card closes
          rather than going at once. */}
      <AnimatePresence custom initial={false}>
        {card && turn && (
          <CardPresence key="work-card" opens={cardOpens}>
            <WorkCardView
              card={card}
              isCurrent={turn.phase === "working"}
              sessionId={sessionId}
            />
          </CardPresence>
        )}
      </AnimatePresence>
    </TaskCardFace>
  );
}

/** What a task's card looks like, whether or not the task exists yet. */
function TaskCardFace({
  badges,
  children,
  disabled,
  firstLine,
  isWorking,
  mark,
  onOpen,
  onStop,
  span,
  title,
}: {
  badges?: ReactNode;
  children?: ReactNode;
  disabled: boolean;
  firstLine: string;
  isWorking: boolean;
  /** What a finished task wears after its first line. */
  mark?: ReactNode;
  onOpen?: () => void;
  onStop?: () => void;
  span: number | undefined;
  title: string;
}) {
  return (
    <div className="flex max-w-115 flex-col gap-2">
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
          disabled={disabled}
          onClick={onOpen}
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
              ) : (
                mark
              )}
              {badges}
            </span>
            <span className="block truncate text-xs text-muted-foreground tabular-nums">
              Task · {title}
              {span !== undefined && ` · ${formatRoughSpan(span)}`}
            </span>
          </span>
        </button>
        {onStop && (
          <button
            aria-label="Stop this task"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover/task:opacity-100 hover:bg-muted hover:text-foreground"
            onClick={onStop}
            type="button"
          >
            <StopIcon className="size-3.5" weight="fill" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
