import type { SessionMessagePart } from "@instrument-org/workspace/client";

import { useMachine } from "@xstate/react";
import { AlertCircle, Loader2Icon, Pause, Play } from "lucide-react";
import { useEffect } from "react";

import { getAssetUrl } from "../../lib/get-asset-url";
import { Favicon } from "../favicon";
import { ImageWithFallback } from "../image-with-fallback";
import { Slider } from "../ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { agentBrowserPlayerMachine } from "./agent-browser-player-machine";

type BrowserCommandObservation = Extract<
  SessionMessagePart.ToolPartContextItem,
  { kind: "agent-browser-command" }
>;

// One UI timeline step. Not the same as `AgentBrowserCommandContextItem`: we
// expand a single observation into 1 to N frames (start, optional end, or
// error when `complete` has no `endScreenshot`).
type PlayableFrame =
  | {
      error: string | undefined;
      id: string;
      kind: "error";
      observationId: string;
      subcommand: string;
    }
  | {
      id: string;
      // Set when this frame represents an in-flight observation that has not
      // yet captured an "after" screenshot. We still render the most recent
      // known screenshot, but show a spinner in place of the favicon.
      isPending: boolean;
      kind: "screenshot";
      observationId: string;
      screenshot: SessionMessagePart.AgentBrowserScreenshot;
      subcommand: string;
    };

const SLIDER_STEP = 0.01;

export function AgentBrowserPlayer({
  assetBaseUrl,
  isStreaming,
  observations,
}: {
  assetBaseUrl: string;
  isStreaming: boolean;
  observations: BrowserCommandObservation[];
}) {
  const frames = buildFrames(observations);

  const frameCount = frames.length;
  const lastFrameIndex = Math.max(0, frameCount - 1);

  const [snapshot, send] = useMachine(agentBrowserPlayerMachine, {
    input: { isStreaming, lastFrameIndex },
  });

  useEffect(() => {
    send({ lastFrameIndex, type: "frames.changed" });
  }, [lastFrameIndex, send]);

  const playhead = snapshot.context.playhead;
  // Tag is set on UserControlled.Playing - the slider thumb is moving on its
  // own and the button reads as pause.
  const showPause = snapshot.hasTag("playing");
  const displayedIndex = clampIndex(Math.floor(playhead), lastFrameIndex);

  if (frameCount === 0) {
    return null;
  }

  const currentFrame = frames[displayedIndex];
  if (!currentFrame) {
    return null;
  }

  const handleSliderChange = (values: number[]) => {
    const [next] = values;
    if (next === undefined) {
      return;
    }
    send({ type: "scrub", value: next });
  };

  const togglePlay = () => {
    if (frameCount <= 1) {
      return;
    }
    send({ type: showPause ? "pause" : "play" });
  };

  const showFaviconLoader =
    currentFrame.kind === "screenshot" &&
    (currentFrame.isPending ||
      (isStreaming && displayedIndex === lastFrameIndex));

  return (
    <div className="flex flex-col gap-1.5 border-b border-border/50 bg-muted/40 p-2">
      <FrameHeader frame={currentFrame} showFaviconLoader={showFaviconLoader} />
      <FramePreview
        assetBaseUrl={assetBaseUrl}
        frame={currentFrame}
        isStreaming={isStreaming}
      />
      {frameCount > 1 && (
        <PlayerControls
          displayedIndex={displayedIndex}
          frameCount={frameCount}
          isStreaming={isStreaming}
          onSliderChange={handleSliderChange}
          onTogglePlay={togglePlay}
          playhead={playhead}
          showPause={showPause}
        />
      )}
    </div>
  );
}

function buildFrames(
  observations: BrowserCommandObservation[],
): PlayableFrame[] {
  const frames: PlayableFrame[] = [];
  for (const obs of observations) {
    const isPending = obs.status === "pending";
    if (obs.startScreenshot) {
      frames.push({
        id: `${obs.id}:start`,
        isPending,
        kind: "screenshot",
        observationId: obs.id,
        screenshot: obs.startScreenshot,
        subcommand: obs.subcommand,
      });
    }
    if (isPending) {
      continue;
    }
    if (obs.endScreenshot) {
      // Skip a duplicate end frame when the page didn't change at all - the
      // start frame already represents this state.
      if (obs.endScreenshot.path !== obs.startScreenshot?.path) {
        frames.push({
          id: `${obs.id}:end`,
          isPending: false,
          kind: "screenshot",
          observationId: obs.id,
          screenshot: obs.endScreenshot,
          subcommand: obs.subcommand,
        });
      }
      continue;
    }
    frames.push({
      error: obs.error,
      id: `${obs.id}:error`,
      kind: "error",
      observationId: obs.id,
      subcommand: obs.subcommand,
    });
  }
  return frames;
}

function clampIndex(value: number, max: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function FrameHeader({
  frame,
  showFaviconLoader,
}: {
  frame: PlayableFrame;
  showFaviconLoader: boolean;
}) {
  if (frame.kind === "error") {
    return (
      <div className="flex min-w-0 items-center gap-1.5 px-0.5">
        <AlertCircle className="size-3.5 shrink-0 text-destructive" />
        <span className="min-w-0 truncate text-[11px] text-destructive">
          {frame.error ?? "Capture failed"}
        </span>
        <span className="ml-auto shrink-0 truncate font-mono text-[11px] text-muted-foreground">
          {frame.subcommand}
        </span>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-1.5 px-0.5">
      {showFaviconLoader ? (
        <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <Favicon className="size-3.5" url={frame.screenshot.url} />
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="min-w-0 truncate text-[11px] text-foreground/80">
            {frame.screenshot.title || frame.screenshot.url}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm break-all">
          {frame.screenshot.url}
        </TooltipContent>
      </Tooltip>
      <span className="ml-auto shrink-0 truncate font-mono text-[11px] text-muted-foreground">
        {frame.subcommand}
      </span>
    </div>
  );
}

function FramePreview({
  assetBaseUrl,
  frame,
  isStreaming,
}: {
  assetBaseUrl: string;
  frame: PlayableFrame;
  isStreaming: boolean;
}) {
  if (frame.kind === "error") {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-sm border border-destructive/60 bg-muted/40">
        <AlertCircle className="size-5 text-destructive" />
      </div>
    );
  }
  const url = getAssetUrl({
    assetBase: assetBaseUrl,
    filePath: frame.screenshot.path,
  });
  const filename =
    frame.screenshot.path.split("/").pop() ?? frame.screenshot.path;
  const headerLabel = frame.screenshot.title || frame.screenshot.url;
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-sm border border-border/50 bg-black">
      <ImageWithFallback
        alt={headerLabel}
        className="h-full w-full object-contain"
        fallbackClassName="h-full w-full"
        filename={filename}
        src={url}
      />
      {isStreaming && <div className="activity-indicator" />}
    </div>
  );
}

function PlayerControls({
  displayedIndex,
  frameCount,
  isStreaming,
  onSliderChange,
  onTogglePlay,
  playhead,
  showPause,
}: {
  displayedIndex: number;
  frameCount: number;
  isStreaming: boolean;
  onSliderChange: (values: number[]) => void;
  onTogglePlay: () => void;
  playhead: number;
  showPause: boolean;
}) {
  const lastFrameIndex = frameCount - 1;
  const timelineMax = lastFrameIndex + (isStreaming ? 1 : 0);
  return (
    <div className="flex items-center gap-2 px-0.5">
      <button
        aria-label={showPause ? "Pause" : "Play"}
        className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onTogglePlay}
        type="button"
      >
        {showPause ? <Pause className="size-3" /> : <Play className="size-3" />}
      </button>
      <Slider
        className="w-full"
        max={timelineMax}
        min={0}
        onValueChange={onSliderChange}
        step={SLIDER_STEP}
        value={[playhead]}
      />
      <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
        {displayedIndex + 1}/{frameCount}
      </span>
    </div>
  );
}
