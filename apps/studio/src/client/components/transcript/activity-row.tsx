import {
  getToolLabel,
  getToolStreamingLabel,
  TOOL_ICONS,
} from "@/client/lib/tool-display";
import { cn } from "@/client/lib/utils";
import {
  type ActivityRow,
  type ChatId,
  thoughtText,
  type ToolName,
  type TurnStep,
} from "@instrument-org/workspace/client";
import { BrainIcon } from "@phosphor-icons/react/Brain";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { use, useState, type ReactNode } from "react";

import { WorkingMark } from "../icons/working-mark";
import { ToolCallBody } from "../message-part/tool-call";
import { Favicon } from "../favicon";
import { AppChipIcon } from "../inline-link";
import { SessionMarkdown } from "../session-markdown";
import { ShimmerSweep } from "../shimmer-sweep";
import { useReleaseAutoScroll } from "../transcript-scroll-context";
import { RollingText } from "./rolling-text";
import { useStepPart } from "./transcript-data";
import { TranscriptActionsContext } from "./transcript-actions";
import { formatClock, useTicking } from "./time";

/**
 * A thought's words, set back from the work around them, with the space a
 * section label takes pulled in and lines set closer: a written answer's
 * rhythm is too loose here.
 */
export const THOUGHT_PROSE =
  "leading-5 opacity-50 prose-headings:mb-0! [&_:is(h1,h2,h3,h4,h5,h6)+p]:mt-1! [&>p.markdown-section-label]:mt-4! [&>p.markdown-section-label]:mb-0! [&>p.markdown-section-label+p]:mt-1!";

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
  rollKey,
  rowId,
  sweepsIn = false,
}: {
  children?: ReactNode;
  isLive?: boolean;
  isOpen?: boolean;
  label: string;
  mark: ReactNode;
  onClick?: () => void;
  places?: ReactNode;
  right?: ReactNode;
  /** Rolls the label when this changes; without one the label just changes. */
  rollKey?: string;
  /** Names the row for the transcript debug page. */
  rowId?: string;
  /**
   * Sweeps a new label in left to right, as a chat's title arrives, for a
   * line that changes once its work is done: a roll reads as work going on.
   */
  sweepsIn?: boolean;
}) {
  const [shownLabel, setShownLabel] = useState(label);
  const [isSweeping, setIsSweeping] = useState(false);
  if (label !== shownLabel) {
    setShownLabel(label);
    setIsSweeping(sweepsIn);
  }
  const words = (
    <span
      className={cn(
        "block min-w-0 truncate",
        isLive
          ? "brand-shiny-text"
          : "text-muted-foreground group-hover/row:text-foreground",
        isSweeping && "title-arrival",
      )}
      // A label that changes again mid-sweep starts its own sweep.
      key={isSweeping ? label : undefined}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) {
          setIsSweeping(false);
        }
      }}
    >
      {label}
      {isLive && <ShimmerSweep text={label} />}
    </span>
  );
  return (
    <div className="flex min-w-0 flex-col" data-transcript-row={rowId}>
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
        {rollKey === undefined ? (
          words
        ) : (
          <RollingText className="min-w-0" rollKey={rollKey}>
            {words}
          </RollingText>
        )}
        {places}
        {right && (
          <span className="flex shrink-0 items-center text-xs text-muted-foreground tabular-nums">
            {right}
          </span>
        )}
        {onClick && (
          <CaretRightIcon
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition duration-150",
              isOpen && "rotate-90",
              isLive && !isOpen && "opacity-0 group-hover/row:opacity-100",
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

function StepMark({ step }: { step: TurnStep | undefined }) {
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
 * explanation under it, and once done a quiet line opening onto its calls. Only
 * the one working has a clock.
 */
export function ActivityRowView({
  chatId,
  isLive,
  row,
  thought,
}: {
  chatId: ChatId;
  isLive: boolean;
  row: ActivityRow;
  /** The thought going on, which the row's own steps leave out. */
  thought?: TurnStep;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const releaseAutoScroll = useReleaseAutoScroll();
  const now = useTicking(isLive);
  const steps = row.steps.filter((step) => step.tool !== "reasoning");
  const current = row.steps.findLast((step) => step.explanation !== undefined);
  const lastStep = steps.at(-1);
  const counts = countsText(row);
  const opened = thought ? [...row.steps, thought] : row.steps;
  const label =
    row.title ??
    (lastStep ? stepLabel(lastStep) : isLive ? "Thinking" : "Thought");
  return (
    <RowLine
      isLive={isLive}
      isOpen={isOpen}
      label={label}
      mark={isLive ? <WorkingMark /> : <StepMark step={lastStep} />}
      onClick={() => {
        releaseAutoScroll();
        setIsOpen((open) => !open);
      }}
      places={<Badges apps={row.apps} sites={row.sites} />}
      right={
        <>
          <RollingText rollKey={counts}>
            {counts && (
              <span className="mr-1.5 block text-foreground/70">{counts}</span>
            )}
          </RollingText>
          {isLive && `· ${formatClock(now - row.startedAt.getTime())}`}
        </>
      }
      // A name still being written grows in place, and a new call moves it on.
      rollKey={
        isLive
          ? row.title
            ? "named"
            : (lastStep?.metadata.id ?? "thinking")
          : undefined
      }
    >
      {isLive && current?.explanation && (
        <RollingText className="ml-7" rollKey={current.metadata.id}>
          <span className="block truncate text-xs text-muted-foreground">
            {current.explanation}
          </span>
        </RollingText>
      )}
      {isOpen && (
        <div className="mt-1 ml-7 flex flex-col gap-1.5">
          {opened.length === 1 && opened[0] ? (
            <StepDetail chatId={chatId} step={opened[0]} />
          ) : (
            opened.map((step) => (
              <StepRow chatId={chatId} key={step.metadata.id} step={step} />
            ))
          )}
        </div>
      )}
    </RowLine>
  );
}

/**
 * An activity in an opened Worked row: its name as a quiet heading over its
 * calls, listed flat at the heading's own edge, so the fold steps right only
 * once however its work was grouped. A run the agent didn't name has no
 * heading, since it would only repeat its call.
 */
export function FoldedActivityView({
  chatId,
  row,
}: {
  chatId: ChatId;
  row: ActivityRow;
}) {
  const counts = countsText(row);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {row.title && (
        <p className="flex h-7 min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <span className="min-w-0 truncate">{row.title}</span>
          {counts && <span className="shrink-0">· {counts}</span>}
        </p>
      )}
      {row.steps.map((step) => (
        <StepRow chatId={chatId} key={step.metadata.id} step={step} />
      ))}
    </div>
  );
}

function stepLabel(step: TurnStep): string {
  const tool = toolOf(step);
  if (!tool) {
    return "Thought";
  }
  if (step.explanation) {
    return step.explanation;
  }
  return step.status === "running" || step.status === "writing"
    ? getToolStreamingLabel(tool)
    : getToolLabel(tool);
}

function StepRow({ chatId, step }: { chatId: ChatId; step: TurnStep }) {
  const [isOpen, setIsOpen] = useState(false);
  const releaseAutoScroll = useReleaseAutoScroll();
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
      rowId={step.metadata.id}
    >
      {isOpen && (
        <div className="my-1">
          <StepDetail chatId={chatId} step={step} />
        </div>
      )}
    </RowLine>
  );
}

/** What an opened step shows, read whole: a call's card, a thought's words. */
export function StepDetail({
  chatId,
  step,
}: {
  chatId: ChatId;
  step: TurnStep;
}) {
  const { onRetry } = use(TranscriptActionsContext);
  const part = useStepPart(step, true);
  if (!part) {
    return (
      <p className="py-1 text-xs text-muted-foreground">Opening the call…</p>
    );
  }
  if (part.type === "reasoning") {
    return (
      <SessionMarkdown
        assetVersion={part.metadata.id}
        chatId={chatId}
        className={cn("w-full", THOUGHT_PROSE)}
        isStreaming={part.state === "streaming"}
        markdown={thoughtText(part.text)}
      />
    );
  }
  const counts = countsText({ counts: step.facts?.counts ?? [] });
  const apps = [...new Set((step.facts?.apps ?? []).map((call) => call.app))];
  return (
    <>
      <ToolCallBody chatId={chatId} onRetry={onRetry} part={part} />
      {/* What the call did in the apps it reached, as its row counts it. */}
      {counts && (
        <p className="mt-1.5 flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <Badges apps={apps} sites={[]} />
          <span className="text-foreground/70">{counts}</span>
        </p>
      )}
    </>
  );
}
