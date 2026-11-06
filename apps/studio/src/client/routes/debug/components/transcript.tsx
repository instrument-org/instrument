import {
  type CommandFacts,
  type TaskCardFacts,
  type TranscriptSurface,
  TranscriptSurfaceContext,
} from "@/client/components/transcript/surface";
import { Transcript } from "@/client/components/transcript/transcript";
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
import { rpcClient } from "@/client/rpc/client";
import {
  type ChatId,
  ChatIdSchema,
  getToolNameByType,
  isToolPart,
  type ChatInfo,
  type SessionMessagePart,
  type StepPart,
  type StoreId,
  type TranscriptMessage,
  transcriptMessage,
  turnsOf,
} from "@instrument-org/workspace/client";
import { type Icon } from "@phosphor-icons/react";
import { ArticleIcon } from "@phosphor-icons/react/Article";
import { BrainIcon } from "@phosphor-icons/react/Brain";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { InfoIcon } from "@phosphor-icons/react/Info";
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip";
import { PauseIcon } from "@phosphor-icons/react/Pause";
import { PlayIcon } from "@phosphor-icons/react/Play";
import { SkipBackIcon } from "@phosphor-icons/react/SkipBack";
import { SkipForwardIcon } from "@phosphor-icons/react/SkipForward";
import { UserIcon } from "@phosphor-icons/react/User";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useAtom } from "jotai";
import {
  createContext,
  Profiler,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod";

import { buildFrames, type Frame, type FrameMark } from "../-transcript/frames";
import { chatFrames, lastTurns, readOnlyClient } from "../-transcript/replay";
import { RowInspector } from "../-transcript/row-inspector";
import { type DebugScenario, scenarios } from "../-transcript/scenarios";
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
  chat: ChatIdSchema.optional(),
  scenario: z.string().optional(),
});

export const Route = createFileRoute("/debug/components/transcript")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug transcript" }],
  }),
  validateSearch: searchSchema,
});

// A scenario's frames, stamped so its last one happens as the page opens: a row
// that has not finished measures itself against the wall clock, and a turn folds
// a few seconds after its last event. So a settled scenario folds right after it
// lands, as it would, and an earlier frame has the time a real one would have had.
function framesOf(script: DebugScenario["script"]): Frame[] {
  const startedAt = Date.now();
  const first = buildFrames(script, startedAt).at(-1)?.messages;
  const lastAt = first?.at(-1)?.metadata.createdAt.getTime() ?? startedAt;
  return buildFrames(script, startedAt - (lastAt - startedAt));
}

// One timeline row, in pixels. The list turns scroll position into a frame by
// this number alone, so it has to stay the row's own height (`h-7`).
const ROW_HEIGHT = 28;

// How far a wheel has to travel before the timeline moves on. No single event
// ever moves more than one frame, so a mouse, whose every notch is one large
// event, steps once per notch; a trackpad, which sends a stream of small ones,
// still runs as fast as it is pushed.
const WHEEL_STEP = 24;

const chatInfo: ChatInfo = {
  createdAt: new Date(0),
  id: ChatIdSchema.parse("debug-transcript"),
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

/** What a frame is, for the surface: its messages, its place in the run, and its tasks. */
interface DebugFrame {
  commands: readonly CommandFacts[];
  frameIndex: number;
  lastFrameIndex: number;
  messages: readonly SessionMessagePart.Type[];
  tasks: Map<string, { frames: Frame[]; ended: string; title: string }>;
  taskStarts: Map<string, number>;
}

const DebugFrameContext = createContext<DebugFrame | undefined>(undefined);

/** A stand-in for a page's picture, changing as the frames go by. */
function DebugPagePicture() {
  const frame = use(DebugFrameContext);
  const seed = Math.floor((frame?.frameIndex ?? 0) / 3);
  const widths = [60, 92, 74, 88, 66, 95, 70].map(
    (width, index) => 40 + ((width + seed * 13 + index * 7) % 60),
  );
  return (
    <div className="flex size-full flex-col gap-2 bg-background p-4">
      <div className="h-3 w-1/3 rounded-sm bg-foreground/20" />
      <div className="h-12 w-full rounded-md bg-foreground/5" />
      {widths.map((width, index) => (
        <div
          className="h-1.5 rounded-sm bg-foreground/10"
          key={index}
          style={{ width: `${width.toString()}%` }}
        />
      ))}
    </div>
  );
}

function taskFrame(frame: DebugFrame | undefined, id: StoreId.Session) {
  const task = frame?.tasks.get(id);
  const start = frame?.taskStarts.get(id);
  if (!frame || !task || start === undefined) {
    return undefined;
  }
  // Its whole run plays out between its start and the end of its chat's frames.
  const through =
    (frame.frameIndex - start) / Math.max(frame.lastFrameIndex - 3 - start, 1);
  const at = Math.min(
    Math.max(Math.round(through * (task.frames.length - 1)), 0),
    task.frames.length - 1,
  );
  return { at, task, working: at < task.frames.length - 1 };
}

const debugSurface: TranscriptSurface = {
  onOpenFile: noop,
  onOpenTask: noop,
  onOpenUrl: noop,
  onStopCommand: noop,
  onStopTask: noop,
  PagePicture: DebugPagePicture,
  useHostPaths: (paths) =>
    Object.fromEntries(paths.map((path) => [path, path])),
  useCommands: () => use(DebugFrameContext)?.commands ?? [],
  useStepPart: (step: StepPart) => {
    const part = use(DebugFrameContext)?.messages.find(
      (each) => each.metadata.id === step.metadata.id,
    );
    return part && (isToolPart(part) || part.type === "reasoning")
      ? part
      : undefined;
  },
  useTaskFacts: (id): TaskCardFacts | undefined => {
    const frame = use(DebugFrameContext);
    const found = taskFrame(frame, id);
    if (!found) {
      // A real chat's task works until the wake saying it finished lands.
      const event = frame?.messages
        .flatMap((part) =>
          part.type === "data-taskEvent" ? part.data.events : [],
        )
        .find((each) => each.sessionId === id && each.status !== "overdue");
      return (
        event && {
          ended: event.summary?.split("```")[0],
          failed: event.status === "error",
          stoppable: false,
          title: event.title,
          working: false,
        }
      );
    }
    const messages = lightMessages(found.task.frames[found.at]?.messages ?? []);
    const row = turnsOf(messages, { isRunning: found.working })
      .at(-1)
      ?.rows.findLast((each) => each.kind === "activity");
    return {
      ended: found.task.ended,
      failed: false,
      ...(row?.kind === "activity" && row.title && { step: row.title }),
      stoppable: found.working,
      title: found.task.title,
      working: found.working,
    };
  },
  useTaskMessages: (id) => {
    const found = taskFrame(use(DebugFrameContext), id);
    return found
      ? lightMessages(found.task.frames[found.at]?.messages ?? [])
      : [];
  },
};

function lightMessages(
  messages: Frame["messages"],
  isDeveloperMode = false,
): TranscriptMessage[] {
  return messages.flatMap((message) => {
    const light = transcriptMessage(message, { isDeveloperMode });
    return light ? [light] : [];
  });
}

/** A real chat's last few turns, read once and only ever read. */
function ChatReplay({ id }: { id: ChatId }) {
  const { data: scenario, error } = useQuery({
    gcTime: 0,
    queryFn: async () => {
      const chat = await rpcClient.workspace.chats.byId.call({ id });
      const { sessionId } = chat ?? {};
      const stored = sessionId
        ? await rpcClient.workspace.message.list.call({ id, sessionId })
        : [];
      const frames = chatFrames(lastTurns(stored, 5));
      const name = chat?.title ?? id;
      return { chat: { ...chatInfo, id }, frames, id, name, script: [] };
    },
    queryKey: ["debug-transcript-replay", id],
    staleTime: Infinity,
  });
  return scenario ? (
    <QueryClientProvider client={readOnlyClient}>
      <Viewer scenario={scenario} />
    </QueryClientProvider>
  ) : (
    (error?.message ?? "Reading this chat…")
  );
}

function RouteComponent() {
  const { chat, scenario: scenarioParam } = Route.useSearch();
  const scenario =
    scenarios.find((entry) => entry.id === scenarioParam) ?? scenarios[0];

  if (chat) {
    return <ChatReplay id={chat} key={chat} />;
  }
  if (!scenario) {
    return null;
  }

  return (
    <Viewer
      // Remounting per scenario is what resets the frame, the scroller, and
      // every group's open state together, so a scenario is always entered the
      // way it would be entered fresh.
      key={scenario.id}
      scenario={scenario}
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

/** With `frames` it is a real chat's, drawn in place of a script. */
type Playable = DebugScenario & { chat?: ChatInfo; frames?: Frame[] };

function Viewer({ scenario }: { scenario: Playable }) {
  // Built once per scenario, and not because it is slow: every part keeps the
  // id it was born with, so React sees a row change rather than a row replaced,
  // which is the thing being looked at on this page.
  const frames = useMemo(
    () => scenario.frames ?? framesOf(scenario.script),
    [scenario.frames, scenario.script],
  );
  const tasks = useMemo(
    () =>
      new Map(
        Object.entries(scenario.tasks ?? {}).map(([id, task]) => [
          id,
          { ...task, frames: framesOf(task.script) },
        ]),
      ),
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

  if (!frame) {
    return null;
  }

  return (
    <div className="flex size-full min-h-0 [&_[data-inspected]]:rounded-sm [&_[data-inspected]]:outline [&_[data-inspected]]:outline-offset-2 [&_[data-inspected]]:outline-foreground/20">
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
            <MessageScrollerViewport
              className="@container/transcript"
              data-transcript
            >
              <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-2 p-4 pb-8 [--transcript-room:100cqi]">
                <Profiler
                  id="transcript"
                  onRender={(_id, _phase, actualDuration) => {
                    renderMs.current = actualDuration;
                  }}
                >
                  <FrameTranscript
                    chat={scenario.chat}
                    commands={scenario.commands}
                    frame={frame}
                    frameIndex={shown}
                    frames={frames}
                    isDeveloperMode={isDeveloperMode}
                    key={isDeveloperMode ? "developer" : "person"}
                    pageTurns={scenario.pageTurns}
                    tasks={tasks}
                  />
                </Profiler>
              </MessageScrollerContent>
            </MessageScrollerViewport>
          </MessageScroller>
        </MessageScrollerProvider>
      </div>

      <aside className="flex w-96 shrink-0 flex-col border-l bg-muted/20">
        <div className="border-b px-3 py-2">
          <h2 className="text-sm font-medium">{scenario.name}</h2>
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
        <RowInspector
          className={replays ? "h-2/5 shrink-0" : "flex-1"}
          frame={frame}
          isDeveloperMode={isDeveloperMode}
          messages={lightMessages(frame.messages, isDeveloperMode)}
          sessionId={frame.messages[0]?.metadata.sessionId}
          transcript={transcript}
        />
      </aside>
    </div>
  );
}

/**
 * A frame as the transcript draws it, through the same projection the feed uses,
 * and for a scenario that says so, a page of turns at a time as the feed gives them.
 */
function FrameTranscript({
  chat,
  commands,
  frame,
  frameIndex,
  frames,
  isDeveloperMode,
  pageTurns,
  tasks,
}: {
  chat: ChatInfo | undefined;
  commands: DebugScenario["commands"];
  frame: Frame;
  frameIndex: number;
  frames: Frame[];
  isDeveloperMode: boolean;
  pageTurns: number | undefined;
  tasks: DebugFrame["tasks"];
}) {
  const allMessages = useMemo(
    () => lightMessages(frame.messages, isDeveloperMode),
    [frame.messages, isDeveloperMode],
  );
  const [shownTurns, setShownTurns] = useState(pageTurns);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const turns = useMemo(
    () =>
      turnsOf(allMessages, { isRunning: frame.isAgentRunning }).map(
        (turn) => turn.id,
      ),
    [allMessages, frame.isAgentRunning],
  );
  const firstShown =
    shownTurns === undefined ? undefined : turns.at(-shownTurns);
  const from =
    firstShown === undefined
      ? 0
      : allMessages.findIndex((message) => message.id === firstShown);
  const messages = useMemo(
    () => allMessages.slice(Math.max(from, 0)),
    [allMessages, from],
  );
  const taskStarts = useMemo(() => {
    const starts = new Map<string, number>();
    for (const [at, each] of frames.entries()) {
      for (const message of each.messages) {
        for (const part of message.parts) {
          if (part.type === "tool-bash" && part.state === "output-available") {
            for (const handOff of part.output.handOffs ?? []) {
              if (!starts.has(handOff.sessionId)) {
                starts.set(handOff.sessionId, at);
              }
            }
          }
        }
      }
    }
    return starts;
  }, [frames]);
  const sessionId = frame.messages[0]?.metadata.sessionId;
  // Going for a while by now, or ended after its turn did.
  const [startedAgo] = useState(() => Date.now() - 40_000);
  const debugFrame = useMemo(
    (): DebugFrame => ({
      commands: sessionId
        ? (commands ?? []).map((command) => ({
            ...command,
            sessionId,
            startedAt: new Date(
              command.ranMs === undefined ? startedAgo : startedAgo + 40_000,
            ),
          }))
        : [],
      frameIndex,
      lastFrameIndex: frames.length - 1,
      messages: frame.messages.flatMap((message) => message.parts),
      tasks,
      taskStarts,
    }),
    [
      commands,
      frame.messages,
      frameIndex,
      frames.length,
      sessionId,
      startedAgo,
      taskStarts,
      tasks,
    ],
  );
  if (!sessionId) {
    return null;
  }
  return (
    <DebugFrameContext value={debugFrame}>
      <TranscriptSurfaceContext value={debugSurface}>
        <Transcript
          chatInfo={chat ?? chatInfo}
          hasOlder={from > 0}
          isDeveloperMode={isDeveloperMode}
          isLoadingOlder={isLoadingOlder}
          isRunning={frame.isAgentRunning}
          messages={messages}
          onContinue={noop}
          onLoadOlder={() => {
            if (isLoadingOlder) {
              return;
            }
            setIsLoadingOlder(true);
            // A page takes a moment to arrive in the app, and the scroller has
            // to keep the reader's place when it does.
            window.setTimeout(() => {
              setShownTurns((count) => (count ?? 0) + (pageTurns ?? 0));
              setIsLoadingOlder(false);
            }, 250);
          }}
          onModelChange={noop}
          onRetry={noop}
          onRunAgain={noop}
          sessionId={sessionId}
        />
      </TranscriptSurfaceContext>
    </DebugFrameContext>
  );
}
