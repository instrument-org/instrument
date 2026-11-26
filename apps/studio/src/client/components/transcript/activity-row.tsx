import { openSettings } from "@/client/atoms/settings-modal";
import { getToolStreamingLabel, TOOL_ICONS } from "@/client/lib/tool-display";
import { cn } from "@/client/lib/utils";
import {
  activityLine,
  type ActivityRow,
  type ChatId,
  countsLine,
  foldedActivityLines,
  stepLine,
  SUMMARIZING_LINE,
  thoughtText,
  type ToolName,
  type TurnStep,
} from "@instrument-org/workspace/client";
import { BrainIcon } from "@phosphor-icons/react/Brain";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { use, useState, type ReactNode } from "react";

import { WorkingMark } from "../icons/working-mark";
import { StepSentence } from "../message-part/step-sentence";
import { ToolCallBody } from "../message-part/tool-call";
import { Favicon } from "../favicon";
import { AppChipIcon } from "../inline-link";
import { SessionMarkdown } from "../session-markdown";
import { ShimmerSweep } from "../shimmer-sweep";
import { Button } from "../ui/button";
import { WarningMark } from "../warning-mark";
import { useReleaseAutoScroll } from "../transcript-scroll-context";
import { FOLD_TRANSITION } from "./card-motion";
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
          // Centered beside the larger label, the smaller type sits a pixel
          // above its baseline; the nudge sets the two on one line.
          <span className="flex shrink-0 translate-y-px items-center text-xs text-muted-foreground tabular-nums">
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

/**
 * The dot between a row's words and its clock, drawn rather than typed: the
 * font sets "·" at the middle of its lowercase letters, under the middle of
 * the digits beside it, and a drawn one centers on the line with them.
 */
export function MidDot() {
  return (
    <span
      aria-hidden
      className="mr-1 size-0.5 shrink-0 rounded-full bg-current"
    />
  );
}

/** The most sites a row shows by their icons; the rest are a count after them. */
const SITES_SHOWN = 6;

/**
 * The sites and apps a row reached, each new one sliding in after the last as
 * it arrives. Those already there when the row is drawn stay put.
 */
export function Badges({
  apps,
  sites,
}: {
  apps: readonly string[];
  sites: readonly string[];
}) {
  const isReduced = useReducedMotion();
  if (apps.length === 0 && sites.length === 0) {
    return null;
  }
  const more = sites.length - SITES_SHOWN;
  const arrive = isReduced ? false : { opacity: 0, x: 4 };
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <AnimatePresence initial={false}>
        {apps.map((app) => (
          <motion.span
            animate={{ opacity: 1, x: 0 }}
            initial={arrive}
            key={app}
          >
            <AppChipIcon slug={app} />
          </motion.span>
        ))}
        {sites.slice(0, SITES_SHOWN).map((site) => (
          <motion.span
            animate={{ opacity: 1, x: 0 }}
            className="flex"
            initial={arrive}
            key={site}
          >
            <Favicon className="size-3.5" url={`https://${site}`} />
          </motion.span>
        ))}
      </AnimatePresence>
      {more > 0 && (
        <span className="ml-0.5 text-xs text-muted-foreground tabular-nums">
          +{more}
        </span>
      )}
    </span>
  );
}

function toolOf(step: TurnStep): ToolName | undefined {
  return step.tool === "reasoning"
    ? undefined
    : (step.tool.slice("tool-".length) as ToolName);
}

/** A step that came to nothing, which wears the warning mark. */
function isWarned(step: TurnStep | undefined): boolean {
  return (
    step !== undefined &&
    (step.status === "failed" || step.blocked !== undefined)
  );
}

function StepMark({
  arrives = false,
  step,
  warns = isWarned(step),
}: {
  /** It takes the working mark's place, so it fades in rather than appearing. */
  arrives?: boolean;
  step: TurnStep | undefined;
  warns?: boolean;
}) {
  const tool = step && toolOf(step);
  const Icon = tool ? TOOL_ICONS[tool] : BrainIcon;
  return (
    <span
      className={cn(
        arrives &&
          "animate-in duration-300 ease-out fade-in-0 zoom-in-75 motion-reduce:animate-none",
      )}
    >
      {warns ? (
        <WarningMark />
      ) : (
        <span className="flex size-5 items-center justify-center rounded-lg bg-black/5 dark:bg-white/5">
          {Icon && <Icon className="size-3 text-foreground/70" />}
        </span>
      )}
    </span>
  );
}

/**
 * An activity: while it works the line with its clock and a line under it
 * saying what it is at (`liveDetail`), and once done a quiet line opening onto its calls. Only
 * the one working has a clock. One a blocked step ended the turn in opens by
 * itself, to what blocked it.
 */
export function ActivityRowView({
  chatId,
  isLive,
  isSummarizing = false,
  row,
  thought,
}: {
  chatId: ChatId;
  isLive: boolean;
  /** A summary of the conversation is being written before the next call. */
  isSummarizing?: boolean;
  row: ActivityRow;
  /** The thought going on, which the row's own steps leave out. */
  thought?: TurnStep;
}) {
  const [chosenOpen, setIsOpen] = useState<boolean>();
  const isOpen = chosenOpen ?? row.endsBlocked ?? false;
  const [hasWorked, setHasWorked] = useState(isLive);
  if (isLive && !hasWorked) {
    setHasWorked(true);
  }
  const isReduced = useReducedMotion();
  const releaseAutoScroll = useReleaseAutoScroll();
  const now = useTicking(isLive);
  const steps = row.steps.filter((step) => step.tool !== "reasoning");
  const current = row.steps.findLast((step) => step.explanation !== undefined);
  const lastStep = steps.at(-1);
  const counts = countsLine(row.counts);
  const opened = thought ? [...row.steps, thought] : row.steps;
  // Its line is its one call's own, so it opens straight onto that call.
  const isOneCall = opened.length === 1 && !(row.title && isWarned(opened[0]));
  const label =
    isLive && !lastStep ? (row.title ?? "Thinking") : activityLine(row);
  // A row that has just come settles on its first words without a roll, its
  // name arriving included, since it has only just moved into place; after
  // that a new call in a row the agent didn't name rolls it on. A name that
  // arrives later keeps the key it found, so the words change without a roll.
  const unnamedKey =
    row.title === undefined && steps.length > 1
      ? (lastStep?.metadata.id ?? "settled")
      : "settled";
  const [rollKey, setRollKey] = useState(unnamedKey);
  if (row.title === undefined && unnamedKey !== rollKey) {
    setRollKey(unnamedKey);
  }
  return (
    <RowLine
      isLive={isLive}
      isOpen={isOpen}
      label={label}
      mark={
        isLive ? (
          <WorkingMark />
        ) : (
          <StepMark
            arrives={hasWorked}
            step={lastStep}
            warns={
              steps.some((step) => step.blocked) ||
              (isOneCall && isWarned(lastStep))
            }
          />
        )
      }
      onClick={() => {
        releaseAutoScroll();
        setIsOpen(!isOpen);
      }}
      places={<Badges apps={row.apps} sites={row.sites} />}
      right={
        <>
          {counts && (
            <span className="mr-1.5 block text-foreground/70">{counts}</span>
          )}
          {isLive && (
            <>
              <MidDot />
              {formatClock(now - row.startedAt.getTime())}
            </>
          )}
        </>
      }
      rollKey={isLive ? rollKey : undefined}
    >
      {/* Folds away as the work finishes, so what is under the row moves up
          on the turn's curve rather than jumping a line. */}
      <AnimatePresence initial={false}>
        {isLive && (
          <motion.span
            className="ml-7 block truncate text-xs text-muted-foreground"
            exit={{ height: 0, opacity: 0 }}
            transition={isReduced ? { duration: 0 } : FOLD_TRANSITION}
          >
            {liveDetail(label, current, lastStep, isSummarizing)}
          </motion.span>
        )}
      </AnimatePresence>
      {isOpen && (
        <div className="mt-1 ml-7 flex flex-col gap-1.5">
          {isOneCall && opened[0] ? (
            <StepDetail chatId={chatId} step={opened[0]} />
          ) : (
            opened.map((step) => (
              <StepRow
                chatId={chatId}
                key={step.metadata.id}
                opensByItself={row.endsBlocked && step === lastStep}
                step={step}
              />
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
 * heading, since it would only repeat its call, and a named activity of one
 * call is that call's row under the activity's name, opening onto its card.
 * Its words are `foldedActivityLines`, which a chat's find counts too.
 */
export function FoldedActivityView({
  chatId,
  row,
}: {
  chatId: ChatId;
  row: ActivityRow;
}) {
  const counts = countsLine(row.counts);
  const { calls, heading } = foldedActivityLines(row);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {heading !== undefined && (
        <p className="flex h-7 min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{heading}</span>
          {counts && <span className="shrink-0">· {counts}</span>}
        </p>
      )}
      {calls.map(({ label, step }) => (
        <StepRow
          chatId={chatId}
          key={step.metadata.id}
          label={label}
          step={step}
        />
      ))}
    </div>
  );
}

/**
 * The line under a working activity, there for as long as it works so the row
 * keeps one height, its words changing in place: the current call's
 * explanation, or what the call in flight is doing, or Thinking between calls,
 * or that a summary of the conversation is being written. Never the row's own
 * label again.
 */
function liveDetail(
  label: string,
  current: TurnStep | undefined,
  lastStep: TurnStep | undefined,
  isSummarizing: boolean,
): string {
  const tool = lastStep && toolOf(lastStep);
  const isRunning =
    lastStep?.status === "running" || lastStep?.status === "writing";
  if (isSummarizing && !isRunning) {
    return SUMMARIZING_LINE;
  }
  const said = [
    current?.explanation,
    tool && isRunning ? getToolStreamingLabel(tool) : undefined,
  ].find((words) => words !== undefined && words !== label);
  // A file written with no card to watch it on says how far it has got.
  const lines =
    isRunning && lastStep.shows?.kind === "file"
      ? lastStep.shows.lines
      : undefined;
  if (lines !== undefined) {
    const counted = `${lines.toString()} ${lines === 1 ? "line" : "lines"}`;
    return said === undefined ? counted : `${said} · ${counted}`;
  }
  return said ?? (isRunning ? "Working" : "Thinking");
}

function StepRow({
  chatId,
  label,
  opensByItself = false,
  step,
}: {
  chatId: ChatId;
  label?: string;
  opensByItself?: boolean;
  step: TurnStep;
}) {
  const [chosenOpen, setIsOpen] = useState<boolean>();
  const isOpen = chosenOpen ?? opensByItself;
  const releaseAutoScroll = useReleaseAutoScroll();
  return (
    <RowLine
      isOpen={isOpen}
      label={label ?? stepLine(step)}
      mark={<StepMark step={step} />}
      onClick={() => {
        releaseAutoScroll();
        setIsOpen(!isOpen);
      }}
      places={
        <Badges
          apps={[...new Set((step.facts?.apps ?? []).map((call) => call.app))]}
          sites={[
            ...new Set([...(step.sites ?? []), ...(step.facts?.hosts ?? [])]),
          ]}
        />
      }
      rowId={step.metadata.id}
    >
      {isOpen && (
        <div className="my-1 has-data-step-words:ml-7">
          <StepDetail chatId={chatId} step={step} />
        </div>
      )}
    </RowLine>
  );
}

/**
 * What an opened step shows: what blocked it, else, read whole, a call's card
 * or a thought's words.
 */
export function StepDetail({
  chatId,
  step,
}: {
  chatId: ChatId;
  step: TurnStep;
}) {
  return step.blocked ? (
    <StepSentence
      action={
        step.blocked.inSettings && (
          <Button
            onClick={() => {
              openSettings({ tab: "Permissions" });
            }}
            size="xs"
            variant="secondary"
          >
            Open Permissions
          </Button>
        )
      }
    >
      {step.blocked.why}
    </StepSentence>
  ) : (
    <StepPartDetail chatId={chatId} step={step} />
  );
}

function StepPartDetail({ chatId, step }: { chatId: ChatId; step: TurnStep }) {
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
  const counts = countsLine(step.facts?.counts ?? []);
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
