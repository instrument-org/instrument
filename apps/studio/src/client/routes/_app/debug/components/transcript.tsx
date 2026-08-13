import { ChatStream } from "@/client/components/chat-stream";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Label } from "@/client/components/ui/label";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/client/components/ui/message-scroller";
import { Switch } from "@/client/components/ui/switch";
import { TOOL_ICONS } from "@/client/lib/tool-display";
import { cn } from "@/client/lib/utils";
import {
  getToolNameByType,
  type Task,
  TaskIdSchema,
} from "@instrument-org/workspace/client";
import {
  ArticleIcon,
  BrainIcon,
  CaretDownIcon,
  CheckIcon,
  DotsThreeIcon,
  type Icon,
  InfoIcon,
  PaperclipIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
  UserIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { Profiler, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import { buildFrames, type Frame, type FrameMark } from "../-transcript/frames";
import { scenarios } from "../-transcript/scenarios";
import {
  autoScrollAtom,
  developerModeAtom,
  replayAtom,
  showsBottomEdgeAtom,
  speedAtom,
  SPEEDS,
} from "../-transcript/settings";
import { TranscriptEdgeOverlay } from "../-transcript/transcript-edge";
import { usePlaybackKeys } from "../-transcript/use-playback-keys";
import { useTranscriptEdge } from "../-transcript/use-transcript-edge";

const searchSchema = z.object({
  scenario: z.string().optional(),
});

export const Route = createFileRoute("/_app/debug/components/transcript")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug transcript" }],
  }),
  validateSearch: searchSchema,
});

// When a scenario's clock starts. A row that has not finished measures itself
// against the wall clock, so a transcript stamped at zero reports its first step
// as having run since 1970. Read once at import, which is outside render.
//
// A fixed transcript cannot report a live duration, so a row still running says
// how long this page has been open rather than how long the step took, and
// settles to the scenario's own tick when it finishes. The number is the one
// thing here that is not what the product would show; the row's shape is.
const OPENED_AT = Date.now();

// One timeline row, in pixels. The list turns scroll position into a frame by
// this number alone, so it has to stay the row's own height (`h-7`).
const ROW_HEIGHT = 28;

// How far a wheel has to travel before the timeline moves on. No single event
// ever moves more than one frame, so a mouse, whose every notch is one large
// event, steps once per notch; a trackpad, which sends a stream of small ones,
// still runs as fast as it is pushed.
const WHEEL_STEP = 24;

const task: Task = {
  createdAt: new Date(0),
  id: TaskIdSchema.parse("debug-transcript"),
  title: "Transcript",
  updatedAt: new Date(0),
};

/** The icon and wording one frame gets in the timeline. */
function describe(mark: FrameMark): { icon: Icon; name: string } {
  switch (mark.kind) {
    case "call": {
      const toolName = mark.toolType
        ? getToolNameByType(mark.toolType)
        : undefined;
      return {
        icon: (toolName ? TOOL_ICONS[toolName] : undefined) ?? DotsThreeIcon,
        name: toolName ?? "tool",
      };
    }
    case "context": {
      return { icon: InfoIcon, name: "context" };
    }
    case "empty-step": {
      return { icon: DotsThreeIcon, name: "empty step" };
    }
    case "notes": {
      return { icon: PaperclipIcon, name: "data" };
    }
    case "pause": {
      return { icon: DotsThreeIcon, name: "pause" };
    }
    case "prose": {
      return { icon: ArticleIcon, name: "assistant" };
    }
    case "reasoning": {
      return { icon: BrainIcon, name: "reasoning" };
    }
    case "turn": {
      // A turn that ran out of steps or out of luck is the thing worth spotting
      // in a list where every other row went fine.
      const wentWrong = mark.phase === "capped" || mark.phase === "failed";
      return { icon: wentWrong ? WarningIcon : CheckIcon, name: "turn" };
    }
    case "user": {
      return { icon: UserIcon, name: "user" };
    }
  }
}

function noop() {
  // The transcript's callbacks all leave the page, which this has no use for:
  // nothing here is a real task.
}

function RouteComponent() {
  const { scenario: scenarioParam } = Route.useSearch();
  const scenario =
    scenarios.find((entry) => entry.id === scenarioParam) ?? scenarios[0];

  if (!scenario) {
    return null;
  }

  return (
    <Viewer
      // Remounting per scenario is what resets the frame, the scroller, and
      // every group's open state together, so a scenario is always entered the
      // way it would be entered fresh.
      key={scenario.id}
      scenarioId={scenario.id}
    />
  );
}

/**
 * The scenario as a list, scrolled through rather than dragged.
 *
 * Scroll position *is* the frame: whichever row is under the band across the
 * middle is the one on screen, and the list can only come to rest on a frame.
 * What that buys over a drag handle is everything above and below the band,
 * which is the run either side of where the transcript has got to.
 */
function Timeline({
  frames,
  index,
  onInterrupt,
  onScrub,
}: {
  frames: Frame[];
  index: number;
  /** A reach for the list, which takes playback out of the driving seat. */
  onInterrupt: () => void;
  onScrub: (index: number) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);

  // Follows whatever moved the frame that was not the list itself: play, the
  // buttons, the arrow keys, a wheel. Skipped when the list is already there,
  // so dragging the scrollbar is never interrupted by being told where it is.
  useEffect(() => {
    const node = viewport.current;
    if (!node || Math.round(node.scrollTop / ROW_HEIGHT) === index) {
      return;
    }
    node.scrollTo({ top: index * ROW_HEIGHT });
  }, [index]);

  // The wheel is handled rather than scrolled with. A mouse sends one large
  // event per notch, which native scrolling turns into a jump of several
  // frames; capping every event at a single step makes a notch a step, and
  // leaves a trackpad's stream of small events as fast as it ever was.
  //
  // Native, and not React's `onWheel`, because React attaches wheel listeners
  // passively at the root and `preventDefault` there does nothing.
  const travel = useRef(0);
  const latest = useRef({ index, onInterrupt, onScrub });
  useEffect(() => {
    latest.current = { index, onInterrupt, onScrub };
  });
  useEffect(() => {
    const node = viewport.current;
    if (!node) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      latest.current.onInterrupt();
      travel.current += event.deltaY;
      if (Math.abs(travel.current) < WHEEL_STEP) {
        return;
      }
      const direction = travel.current > 0 ? 1 : -1;
      travel.current = 0;
      latest.current.onScrub(latest.current.index + direction);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      {/* The band the current frame sits under. Painted before the list and
          never over it, so the row it marks stays the brightest thing in the
          panel; on the frame rather than in the scrolling content, so it holds
          still while the list moves. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 h-7 -translate-y-1/2 border-y border-border bg-accent"
      />
      <div
        className="relative h-full snap-y snap-mandatory scrollbar-thin scrollbar-color overflow-y-auto overscroll-contain"
        onPointerDown={onInterrupt}
        onScroll={(event) => {
          // Reporting only: playing scrolls the list too, so interrupting from
          // here would stop playback after a single step.
          onScrub(Math.round(event.currentTarget.scrollTop / ROW_HEIGHT));
        }}
        ref={viewport}
      >
        {/* Half the list's height less half a row, so the first and last frames
            can both reach the band. The percentage is of the scroll frame
            rather than of the content, which is what makes it work without
            measuring anything. */}
        <div className="h-[calc(50%-14px)]" />
        {frames.map((entry, at) => {
          const { icon: Icon, name } = describe(entry.mark);
          const isCurrent = at === index;
          return (
            <button
              className={cn(
                "flex h-7 w-full snap-center items-center gap-2 px-3 text-left font-mono text-[11px]",
                isCurrent
                  ? "font-medium text-foreground"
                  : "text-muted-foreground/70 hover:text-foreground",
              )}
              key={at}
              onClick={() => {
                onScrub(at);
              }}
              // What the step carried, for a frame the transcript draws nothing
              // for. Enough to tell a blank activity from a real one.
              title={entry.mark.detail ?? name}
              type="button"
            >
              <Icon
                className={cn("size-3.5 shrink-0", !isCurrent && "opacity-60")}
                weight={isCurrent ? "fill" : "regular"}
              />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {entry.mark.phase !== undefined && (
                <span
                  className={cn(
                    "shrink-0",
                    isCurrent ? "text-foreground/70" : "opacity-70",
                  )}
                >
                  {entry.mark.phase}
                </span>
              )}
            </button>
          );
        })}
        <div className="h-[calc(50%-14px)]" />
      </div>
    </div>
  );
}

function Toggle({
  checked,
  id,
  label,
  onChange,
}: {
  checked: boolean;
  id: string;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch checked={checked} id={id} onCheckedChange={onChange} />
      <Label className="cursor-pointer text-xs" htmlFor={id}>
        {label}
      </Label>
    </div>
  );
}

function Viewer({ scenarioId }: { scenarioId: string }) {
  const scenario = scenarios.find((entry) => entry.id === scenarioId);
  // Built once per scenario, and not because it is slow: every part keeps the
  // id it was born with, so React sees a row change rather than a row replaced,
  // which is the thing being looked at on this page.
  const frames = useMemo(
    () => (scenario ? buildFrames(scenario.script, OPENED_AT) : []),
    [scenario],
  );

  const lastIndex = Math.max(frames.length - 1, 0);
  const [replays, setReplays] = useAtom(replayAtom);
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useAtom(speedAtom);
  const [isDeveloperMode, setIsDeveloperMode] = useAtom(developerModeAtom);
  const [autoScrolls, setAutoScrolls] = useAtom(autoScrollAtom);
  const [showsBottomEdge, setShowsBottomEdge] = useAtom(showsBottomEdgeAtom);
  const [shownMs, setShownMs] = useState<number>();
  const renderMs = useRef(0);
  const transcript = useRef<HTMLDivElement>(null);

  // The last frame is the whole transcript, so not replaying is not a second way
  // of building one: it is the same fold, read at the end.
  const shown = replays ? Math.min(index, lastIndex) : lastIndex;
  const frame = frames[shown];
  const edge = useTranscriptEdge({ frameRef: transcript, index: shown });

  useEffect(() => {
    if (!replays || !isPlaying) {
      return;
    }
    const timer = setInterval(() => {
      setIndex((current) => {
        if (current >= lastIndex) {
          setIsPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 1000 / speed);
    return () => {
      clearInterval(timer);
    };
  }, [isPlaying, lastIndex, replays, speed]);

  usePlaybackKeys({
    onStep: (by) => {
      if (!replays) {
        return;
      }
      setIsPlaying(false);
      setIndex((current) => Math.min(Math.max(current + by, 0), lastIndex));
    },
    onTogglePlay: () => {
      if (!replays) {
        return;
      }
      setIsPlaying((current) => !current);
    },
  });

  // What the transcript itself cost to render, taken from React rather than a
  // wall clock so it is the component's own work and not the page around it.
  // Read back a frame late, which is what keeps reporting it from being the
  // thing that triggers the next render.
  useEffect(() => {
    setShownMs(renderMs.current);
  }, [shown]);

  if (!scenario || !frame) {
    return null;
  }

  return (
    <div className="flex size-full min-h-0">
      {/* The transcript's own scroll frame, matching the task view, so what is
          measured here is what ships: the same scroller, the same content
          column, the same padding. */}
      <div className="relative flex min-w-0 flex-1 flex-col" ref={transcript}>
        {replays && showsBottomEdge && edge && (
          <TranscriptEdgeOverlay edge={edge} />
        )}
        <MessageScrollerProvider
          autoScroll={autoScrolls}
          defaultScrollPosition="end"
        >
          <MessageScroller className="min-h-0 flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-2 p-4 pb-8">
                <Profiler
                  id="transcript"
                  onRender={(_id, _phase, actualDuration) => {
                    renderMs.current = actualDuration;
                  }}
                >
                  {/* Drawn flat rather than as the scroller's own items. An
                      item that anchors a turn to the top of the reading line
                      buys the room to get there by reserving it below the last
                      row, which is a scroll behavior of the task view rather
                      than anything the transcript drew -- and here it would put
                      the end of the transcript, and the marker that follows it,
                      somewhere below where the transcript actually stops. */}
                  <ChatStream
                    alwaysShowFooter
                    isAgentRunning={frame.isAgentRunning}
                    isDeveloperMode={isDeveloperMode}
                    messages={frame.messages}
                    onContinue={noop}
                    onModelChange={noop}
                    onRetry={noop}
                    onRunAgain={noop}
                    onStartNewTask={noop}
                    task={task}
                  />
                </Profiler>
              </MessageScrollerContent>
            </MessageScrollerViewport>
          </MessageScroller>
        </MessageScrollerProvider>
      </div>

      <aside className="flex w-72 shrink-0 flex-col border-l bg-muted/20">
        <div className="border-b px-3 py-2">
          <h2 className="text-sm font-medium">{scenario.name}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {scenario.about}
          </p>
        </div>

        {replays && (
          <div className="flex items-center gap-1 border-b px-2 py-1.5">
            <Button
              aria-label="Back to the start"
              onClick={() => {
                setIsPlaying(false);
                setIndex(0);
              }}
              size="icon-sm"
              variant="ghost"
            >
              <SkipBackIcon />
            </Button>
            <Button
              aria-label={isPlaying ? "Pause" : "Play"}
              onClick={() => {
                // Playing from the end restarts, so the button never does
                // nothing.
                if (!isPlaying && index >= lastIndex) {
                  setIndex(0);
                }
                setIsPlaying(!isPlaying);
              }}
              size="icon-sm"
              variant="secondary"
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </Button>
            <Button
              aria-label="Skip to the end"
              onClick={() => {
                setIsPlaying(false);
                setIndex(lastIndex);
              }}
              size="icon-sm"
              variant="ghost"
            >
              <SkipForwardIcon />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="ml-auto font-mono" size="sm" variant="ghost">
                  {speed} steps/s
                  <CaretDownIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {SPEEDS.map((option) => (
                  <DropdownMenuItem
                    key={option}
                    onSelect={() => {
                      setSpeed(option);
                    }}
                  >
                    {option} steps/s
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Switches and readouts on separate rows, because they grow for
            different reasons: a switch arrives when there is a new mode, a
            number every time something new is worth measuring. Sharing one row
            in a 288px sidebar means each new number competes with every switch
            already there, and the loser is silently clipped off the edge. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
          <Toggle
            checked={replays}
            id="transcript-replay"
            label="Replay"
            onChange={(next) => {
              setIsPlaying(false);
              setReplays(next);
            }}
          />
          <Toggle
            checked={isDeveloperMode}
            id="transcript-developer-mode"
            label="Dev mode"
            onChange={setIsDeveloperMode}
          />
          {/* Both of these are about watching frames land, and nothing lands
              when the transcript is simply there. */}
          {replays && (
            <>
              <Toggle
                checked={autoScrolls}
                id="transcript-auto-scroll"
                label="Auto-scroll"
                onChange={setAutoScrolls}
              />
              <Toggle
                checked={showsBottomEdge}
                id="transcript-bottom-edge"
                label="Bottom edge"
                onChange={setShowsBottomEdge}
              />
            </>
          )}
        </div>

        {/* Whether the agent is running is the last frame's business and nobody
            else's: it says the same thing for the whole scenario. What is worth
            watching is what each frame costs, and what it did to the column. */}
        <div className="flex items-center gap-3 border-b px-3 py-1.5 font-mono text-xs text-muted-foreground tabular-nums">
          <span>{shownMs === undefined ? "--" : shownMs.toFixed(1)}ms</span>
          {edge && (
            <span
              className={cn(
                "ml-auto",
                edge.delta !== undefined &&
                  edge.delta < 0 &&
                  "text-destructive",
              )}
            >
              {edge.contentHeight}px
              {edge.delta === undefined
                ? ""
                : ` ${edge.delta >= 0 ? "+" : ""}${edge.delta.toString()}`}
            </span>
          )}
        </div>

        {replays && (
          <Timeline
            frames={frames}
            index={shown}
            onInterrupt={() => {
              setIsPlaying(false);
            }}
            onScrub={(next) => {
              setIndex(Math.min(Math.max(next, 0), lastIndex));
            }}
          />
        )}
      </aside>
    </div>
  );
}
