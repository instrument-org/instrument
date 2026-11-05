import { getToolLabel, TOOL_ICONS } from "@/client/lib/tool-display";
import { cn } from "@/client/lib/utils";
import {
  type ActivityRow,
  type ToolName,
  type ChatInfo,
  type TurnStep,
} from "@instrument-org/workspace/client";
import { BrainIcon } from "@phosphor-icons/react/Brain";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { use, useState, type ReactNode } from "react";

import { PlanningDotIcon } from "../icons/planning-dot";
import { ToolCallBody } from "../message-part/tool-call";
import { Favicon } from "../favicon";
import { AppChipIcon } from "../inline-link";
import { useReleaseAutoScroll } from "../transcript-scroll-context";
import { TranscriptSurfaceContext } from "./surface";
import { formatClock, useTicking } from "./time";

/** One line: a mark at the left, words, the places it touched, and how long. */
export function RowLine({
  children,
  isLive = false,
  isOpen,
  label,
  mark,
  onClick,
  places,
  right,
}: {
  children?: ReactNode;
  isLive?: boolean;
  isOpen?: boolean;
  label: string;
  mark: ReactNode;
  onClick?: () => void;
  places?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <button
        aria-expanded={onClick ? (isOpen ?? false) : undefined}
        className={cn(
          "group/row flex h-7 max-w-full min-w-0 items-center gap-2 rounded-lg text-left text-sm outline-none",
          onClick ? "cursor-default" : "pointer-events-none",
        )}
        onClick={onClick}
        type="button"
      >
        <span className="flex size-5 shrink-0 items-center justify-center">
          {mark}
        </span>
        <span
          className={cn(
            "min-w-0 truncate",
            isLive
              ? "font-medium text-foreground"
              : "text-muted-foreground group-hover/row:text-foreground",
          )}
        >
          {label}
        </span>
        {places}
        {right && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {right}
          </span>
        )}
        {onClick && (
          <CaretRightIcon
            className={cn(
              "size-3 shrink-0 text-muted-foreground opacity-0 transition duration-150 group-hover/row:opacity-100",
              isOpen && "rotate-90 opacity-100",
            )}
          />
        )}
      </button>
      {children}
    </div>
  );
}

/** The sites and apps a row reached, joined on as they arrive. */
export function Badges({
  apps,
  sites,
}: {
  apps: readonly string[];
  sites: readonly string[];
}) {
  if (apps.length === 0 && sites.length === 0) {
    return null;
  }
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {apps.map((app) => (
        <AppChipIcon key={app} slug={app} />
      ))}
      {sites.map((site) => (
        <Favicon className="size-3.5" key={site} url={`https://${site}`} />
      ))}
    </span>
  );
}

function toolOf(step: TurnStep): ToolName | undefined {
  return step.tool === "reasoning"
    ? undefined
    : (step.tool.slice("tool-".length) as ToolName);
}

export function StepMark({ step }: { step: TurnStep | undefined }) {
  const tool = step && toolOf(step);
  const Icon = tool ? TOOL_ICONS[tool] : BrainIcon;
  return (
    <span
      className={cn(
        "flex size-5 items-center justify-center rounded-lg bg-black/5 dark:bg-white/5",
        step?.status === "failed" && "bg-warning-500/15",
      )}
    >
      {Icon && <Icon className="size-3 text-foreground/70" />}
    </span>
  );
}

const countsText = (row: Pick<ActivityRow, "counts">) =>
  row.counts
    .map((counted) => `${counted.count.toString()} ${counted.label}`)
    .join(", ");

/**
 * An activity: while it works the line with its clock and the current call's
 * explanation under it, and once done a quiet line opening onto its calls.
 */
export function ActivityRowView({
  chatInfo,
  isLive,
  row,
}: {
  chatInfo: ChatInfo;
  isLive: boolean;
  row: ActivityRow;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const releaseAutoScroll = useReleaseAutoScroll();
  const now = useTicking(isLive);
  const surface = use(TranscriptSurfaceContext);
  const steps = row.steps.filter((step) => step.tool !== "reasoning");
  const running = surface?.useRunningCommands();
  const isStillRunning = steps.some(
    (step) => step.processId !== undefined && running?.has(step.processId),
  );
  const current = row.steps.findLast((step) => step.explanation !== undefined);
  const lastStep = steps.at(-1);
  const counts = countsText(row);
  const elapsed = isLive
    ? now - row.startedAt.getTime()
    : (row.endedAt?.getTime() ?? row.startedAt.getTime()) -
      row.startedAt.getTime();
  const label =
    row.title ??
    (lastStep ? stepLabel(lastStep) : isLive ? "Thinking" : "Thought");
  return (
    <RowLine
      isLive={isLive}
      isOpen={isOpen}
      label={label}
      mark={isLive ? <PlanningDotIcon /> : <StepMark step={lastStep} />}
      onClick={() => {
        releaseAutoScroll();
        setIsOpen((open) => !open);
      }}
      places={<Badges apps={row.apps} sites={row.sites} />}
      right={
        <>
          {isStillRunning && <span className="mr-1.5">Still running</span>}
          {counts && (
            <span className="mr-1.5 text-foreground/70">{counts}</span>
          )}
          {formatClock(elapsed)}
        </>
      }
    >
      {isLive && current?.explanation && (
        <p className="ml-7 truncate text-xs text-muted-foreground">
          {current.explanation}
        </p>
      )}
      {isOpen && (
        <div className="mt-1 ml-7 flex flex-col gap-0.5">
          {steps.length === 1 && lastStep ? (
            <StepDetail chatInfo={chatInfo} step={lastStep} />
          ) : (
            steps.map((step) => (
              <StepRow chatInfo={chatInfo} key={step.metadata.id} step={step} />
            ))
          )}
        </div>
      )}
    </RowLine>
  );
}

function stepLabel(step: TurnStep): string {
  if (step.explanation) {
    return step.explanation;
  }
  const tool = toolOf(step);
  return tool ? getToolLabel(tool) : "Thought";
}

function StepRow({ chatInfo, step }: { chatInfo: ChatInfo; step: TurnStep }) {
  const [isOpen, setIsOpen] = useState(false);
  const releaseAutoScroll = useReleaseAutoScroll();
  const endedAt = step.metadata.endedAt?.getTime();
  const startedAt = (
    step.metadata.startedAt ?? step.metadata.createdAt
  ).getTime();
  return (
    <RowLine
      isOpen={isOpen}
      label={stepLabel(step)}
      mark={<StepMark step={step} />}
      onClick={() => {
        releaseAutoScroll();
        setIsOpen((open) => !open);
      }}
      places={
        <Badges
          apps={[...new Set((step.facts?.apps ?? []).map((call) => call.app))]}
          sites={step.facts?.hosts ?? []}
        />
      }
      right={
        endedAt === undefined ? undefined : formatClock(endedAt - startedAt)
      }
    >
      {isOpen && (
        <div className="my-1">
          <StepDetail chatInfo={chatInfo} step={step} />
        </div>
      )}
    </RowLine>
  );
}

/** What an opened call shows: the card the app draws for it, read whole. */
function StepDetail({
  chatInfo,
  step,
}: {
  chatInfo: ChatInfo;
  step: TurnStep;
}) {
  const surface = use(TranscriptSurfaceContext);
  const part = surface?.useStepPart(step, true);
  if (!part) {
    return (
      <p className="py-1 text-xs text-muted-foreground">Opening the call…</p>
    );
  }
  return <ToolCallBody chatInfo={chatInfo} onRetry={() => {}} part={part} />;
}
