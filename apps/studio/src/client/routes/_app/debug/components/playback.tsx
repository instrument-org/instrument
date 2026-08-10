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
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { Profiler, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import { buildFrames, type Frame, type FrameMark } from "../-playback/frames";
import { scenarios } from "../-playback/scenarios";
import { TranscriptEdgeOverlay } from "../-playback/transcript-edge";
import { usePlaybackKeys } from "../-playback/use-playback-keys";
import { useTranscriptEdge } from "../-playback/use-transcript-edge";

const searchSchema = z.object({
  scenario: z.string().optional(),
});

export const Route = createFileRoute("/_app/debug/components/playback")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug transcript playback" }],
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

// How fast play steps. Named by the rate itself rather than as a multiple:
// there is no real-time pace here to be a multiple of, since a frame is one
// event and events are not evenly spaced in life.
const SPEEDS = [1, 2, 4, 10, 25];

// How far a wheel has to travel before the timeline moves on. No single event
// ever moves more than one frame, so a mouse, whose every notch is one large
// event, steps once per notch; a trackpad, which sends a stream of small ones,
// still runs as fast as it is pushed.
const WHEEL_STEP = 24;

const task: Task = {
  createdAt: new Date(0),
  id: TaskIdSchema.parse("transcript-playback"),
  title: "Transcript playback",
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
    case "planning": {
      return { icon: DotsThreeIcon, name: "planning" };
    }
    case "prose": {
      return { icon: ArticleIcon, name: "answer" };
    }
    case "reasoning": {
      return { icon: BrainIcon, name: "reasoning" };
    }
    case "turn": {
      return { icon: CheckIcon, name: "turn" };
    }
    case "user": {
      return { icon: UserIcon, name: "you" };
    }
  }
}

function noop() {
  // The transcript's callbacks all leave the page, which playback has no use
  // for: nothing here is a real task.
}

function Player({ scenarioId }: { scenarioId: string }) {
  const scenario = scenarios.find((entry) => entry.id === scenarioId);
  // Built once per scenario, and not because it is slow: every part keeps the
  // id it was born with, so React sees a row change rather than a row replaced,
  // which is the thing being looked at on this page.
  const frames = useMemo(
    () => (scenario ? buildFrames(scenario.script, OPENED_AT) : []),
    [scenario],
  );

  const lastIndex = Math.max(frames.length - 1, 0);
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [isDeveloperMode, setIsDeveloperMode] = useState(false);
  const [follows, setFollows] = useState(true);
  const [showsEdge, setShowsEdge] = useState(true);
  const [shownMs, setShownMs] = useState<number>();
  const renderMs = useRef(0);
  const transcript = useRef<HTMLDivElement>(null);

  const frame = frames[Math.min(index, lastIndex)];
  const edge = useTranscriptEdge({ frameRef: transcript, index });

  useEffect(() => {
    if (!isPlaying) {
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
  }, [isPlaying, lastIndex, speed]);

  usePlaybackKeys({
    onStep: (by) => {
      setIsPlaying(false);
      setIndex((current) => Math.min(Math.max(current + by, 0), lastIndex));
    },
    onTogglePlay: () => {
      setIsPlaying((current) => !current);
    },
  });

  // What the transcript itself cost to render, taken from React rather than a
  // wall clock so it is the component's own work and not the page around it.
  // Read back a frame late, which is what keeps reporting it from being the
  // thing that triggers the next render.
  useEffect(() => {
    setShownMs(renderMs.current);
  }, [index]);

  if (!scenario || !frame) {
    return null;
  }

  return (
    <div className="flex size-full min-h-0">
      {/* The transcript's own scroll frame, matching the task view, so what is
          measured here is what ships: the same scroller, the same content
          column, the same padding. */}
      <div className="relative flex min-w-0 flex-1 flex-col" ref={transcript}>
        {showsEdge && edge && <TranscriptEdgeOverlay edge={edge} />}
        <MessageScrollerProvider
          autoScroll={follows}
          defaultScrollPosition="end"
        >
          <MessageScroller className="min-h-0 flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent className="group/assistant-message-footer mx-auto w-full max-w-2xl gap-2 p-4 pb-8">
                <Profiler
                  id="transcript"
                  onRender={(_id, _phase, actualDuration) => {
                    renderMs.current = actualDuration;
                  }}
                >
                  <ChatStream
                    isAgentRunning={frame.isAgentRunning}
                    isDeveloperMode={isDeveloperMode}
                    messages={frame.messages}
                    onContinue={noop}
                    onModelChange={noop}
                    onRetry={noop}
                    onStartNewTask={noop}
                    renderAsItems
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
              // Playing from the end restarts, so the button never does nothing.
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

        <div className="flex items-center gap-4 border-b px-3 py-2">
          <Toggle
            checked={isDeveloperMode}
            id="playback-developer-mode"
            label="Dev mode"
            onChange={setIsDeveloperMode}
          />
          <Toggle
            checked={follows}
            id="playback-follow"
            label="Follow"
            onChange={setFollows}
          />
          <Toggle
            checked={showsEdge}
            id="playback-edge"
            label="Edge"
            onChange={setShowsEdge}
          />
          {/* Whether the agent is running is the last frame's business and
              nobody else's: it says the same thing for the whole scenario. What
              is worth watching is what each frame costs. */}
          {shownMs !== undefined && (
            <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
              {shownMs.toFixed(1)}ms
            </span>
          )}
        </div>

        <Timeline
          frames={frames}
          index={index}
          onInterrupt={() => {
            setIsPlaying(false);
          }}
          onScrub={(next) => {
            setIndex(Math.min(Math.max(next, 0), lastIndex));
          }}
        />
      </aside>
    </div>
  );
}

function RouteComponent() {
  const { scenario: scenarioParam } = Route.useSearch();
  const scenario =
    scenarios.find((entry) => entry.id === scenarioParam) ?? scenarios[0];

  if (!scenario) {
    return null;
  }

  return (
    <Player
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
              // What the call carried, for a frame the transcript draws nothing
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
