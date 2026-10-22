import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { Textarea } from "@/client/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import {
  type Dictation,
  isDictating,
  useDictation,
} from "@/client/hooks/use-dictation";
import {
  appendDictatedText,
  appendDictatedTextWithin,
} from "@/client/lib/dictation-text";
import { createWaveLevel, rmsOf } from "@/client/lib/dictation-wave-level";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { type DictationSurface } from "@/shared/dictation";
import { MicrophoneIcon } from "@phosphor-icons/react/Microphone";
import { StopIcon } from "@phosphor-icons/react/Stop";
import { XIcon } from "@phosphor-icons/react/X";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * The microphone, then Stop while recording. It never stands in for Send:
 * where there is a Send, it sits to its left.
 */
export function DictationButton({
  className,
  dictation,
  disabled = false,
  size = "md",
}: {
  className?: string;
  dictation: Dictation;
  disabled?: boolean;
  /** `sm` for a pill or a field, `md` beside a block composer's Send. */
  size?: "md" | "sm";
}) {
  const { phase } = dictation;
  const box = size === "sm" ? "size-7" : "size-8";
  const icon = size === "sm" ? "size-4" : "size-[18px]";

  if (phase.kind === "recording" || phase.kind === "transcribing") {
    const working = phase.kind === "transcribing";
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={working ? "Transcribing" : "Stop"}
            className={cn(
              box,
              // Solid in both themes, its hover included: the button's own
              // card colors would otherwise show through on hover and in dark.
              "shrink-0 rounded-full bg-foreground p-0 text-background not-disabled:hover:bg-foreground/85 disabled:opacity-100 dark:bg-foreground dark:text-background dark:not-disabled:hover:bg-foreground/85",
              className,
            )}
            disabled={working}
            onClick={() => {
              dictation.stop();
            }}
          >
            {working ? (
              <Spinner className={icon} delay={0} />
            ) : (
              <StopIcon className="size-3.5" weight="fill" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Stop</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Button
      aria-label={
        phase.kind === "starting" ? "Starting the microphone" : "Dictate"
      }
      className={cn(
        box,
        "shrink-0 rounded-full p-0 text-muted-foreground",
        className,
      )}
      disabled={disabled || phase.kind === "starting"}
      onClick={dictation.start}
      variant="ghost"
    >
      {phase.kind === "starting" ? (
        <Spinner className={icon} delay={0} />
      ) : (
        <MicrophoneIcon className={icon} />
      )}
    </Button>
  );
}

/**
 * Throws the recording away, as a round ✕ between the wave and Stop. Only while there
 * is audio to lose: once it has been sent there is nothing here to discard,
 * so it goes invisible but keeps its place, and nothing beside it moves as
 * the words land.
 */
function DictationCancel({
  className,
  dictation,
  size = "md",
}: {
  className?: string;
  dictation: Dictation;
  size?: "md" | "sm";
}) {
  const { phase } = dictation;
  if (!isDictating(phase)) {
    return null;
  }
  const spent = phase.kind === "transcribing";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-hidden={spent}
          aria-label="Cancel"
          className={cn(
            size === "sm" ? "size-7" : "size-8",
            "shrink-0 rounded-full p-0 text-muted-foreground ring-1 ring-border",
            spent && "invisible",
            className,
          )}
          disabled={spent}
          onClick={dictation.cancel}
          variant="ghost"
        >
          <XIcon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Cancel</p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The wave, Cancel and the microphone or Stop, in a row: the wave and Cancel
 * only while dictating, the microphone alone otherwise.
 */
export function DictationControls({
  className,
  dictation,
  disabled,
  size = "md",
}: {
  className?: string;
  dictation: Dictation;
  disabled?: boolean;
  size?: "md" | "sm";
}) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <DictationWave className="mr-1" dictation={dictation} />
      <DictationCancel dictation={dictation} size={size} />
      <DictationButton dictation={dictation} disabled={disabled} size={size} />
    </div>
  );
}

/** How often the wave takes a new bar from the microphone. */
const WAVE_STEP_MS = 50;
const WAVE_BAR_PX = 2;
const WAVE_GAP_PX = 2;

/**
 * A small wave of the microphone's recent loudness, newest at the right, so
 * someone can see it hears them before any words come. Its height follows
 * the voice rather than the room (`createWaveLevel`), and it keeps its place
 * flat once the recording stops.
 */
function DictationWave({
  className,
  dictation,
}: {
  className?: string;
  dictation: Dictation;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { phase, stream } = dictation;
  const live = phase.kind === "recording" ? stream : undefined;
  const shown = isDictating(phase);
  useEffect(() => {
    const element = canvas.current;
    if (!element) {
      return;
    }
    const width = element.clientWidth;
    const height = element.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.round(width * ratio);
    element.height = Math.round(height * ratio);
    const painter = element.getContext("2d");
    const bars: number[] = Array.from(
      { length: Math.floor(width / (WAVE_BAR_PX + WAVE_GAP_PX)) },
      () => 0,
    );
    const paint = () => {
      if (!painter) {
        return;
      }
      painter.setTransform(ratio, 0, 0, ratio, 0, 0);
      painter.clearRect(0, 0, width, height);
      painter.fillStyle = getComputedStyle(element).color;
      bars.forEach((level, index) => {
        const bar = Math.max(WAVE_BAR_PX, level * height);
        painter.beginPath();
        painter.roundRect(
          index * (WAVE_BAR_PX + WAVE_GAP_PX),
          (height - bar) / 2,
          WAVE_BAR_PX,
          bar,
          WAVE_BAR_PX / 2,
        );
        painter.fill();
      });
    };
    paint();
    if (!live) {
      return;
    }
    const context = new AudioContext();
    const analyzer = context.createAnalyser();
    analyzer.fftSize = 1024;
    context.createMediaStreamSource(live).connect(analyzer);
    const samples = new Float32Array(analyzer.fftSize);
    const level = createWaveLevel();
    let frame = 0;
    let last = 0;
    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      if (time - last < WAVE_STEP_MS) {
        return;
      }
      last = time;
      analyzer.getFloatTimeDomainData(samples);
      bars.shift();
      bars.push(level(rmsOf(samples)));
      paint();
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      void context.close().catch(() => undefined);
    };
  }, [live, shown]);
  if (!shown) {
    return null;
  }
  return (
    <canvas
      aria-hidden="true"
      className={cn("h-5 w-24 shrink-0 text-muted-foreground/70", className)}
      ref={canvas}
    />
  );
}

/**
 * What stands in for the words when there are none to show: that it is
 * listening, that the words will come at Stop when live text isn't working,
 * or that they are on their way.
 */
function quietLine({ live, phase }: Dictation) {
  return live?.status === "lost" || live?.status === "unavailable"
    ? "Live text unavailable"
    : phase.kind === "transcribing" && !phase.live
      ? "Transcribing…"
      : "Listening…";
}

/**
 * The words to show where they will land, for a box that shows them in its
 * text: what has been heard, or the line about live text not working, after
 * what was heard before the stream went away.
 */
export function landingWords(dictation: Dictation): {
  interim: string;
  settled: string;
} {
  const quiet = quietLine(dictation);
  const settled = dictation.live?.settled ?? "";
  return quiet === "Listening…"
    ? { interim: dictation.live?.interim ?? "", settled }
    : {
        interim: quiet,
        settled: dictation.live?.status === "lost" ? settled : "",
      };
}

/**
 * The words being heard, on one line: settled words in full, the stretch
 * still being heard fainter after them. Once the line is full it keeps the
 * newest words in view and fades the start out, so it never grows and nothing
 * around it moves. Before any words it says it is listening; when live text
 * is unavailable it says the words will come at Stop instead.
 */
function DictationReadout({
  className,
  dictation,
}: {
  className?: string;
  dictation: Dictation;
}) {
  const { phase } = dictation;
  const line = useRef<HTMLSpanElement>(null);
  const words = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const shown = landingWords(dictation);
  // The words against the line rather than the line's own scroll width,
  // which stops counting them once they overflow at the start.
  useLayoutEffect(() => {
    setOverflowing(
      line.current !== null &&
        words.current !== null &&
        words.current.offsetWidth > line.current.clientWidth,
    );
  }, [shown.settled, shown.interim]);
  if (!isDictating(phase)) {
    return null;
  }
  const quiet = quietLine(dictation);
  return (
    <span
      aria-live="polite"
      className={cn(
        "flex min-w-0 flex-1 overflow-hidden text-sm whitespace-nowrap",
        overflowing &&
          "justify-end [mask-image:linear-gradient(to_right,transparent,black_2rem)]",
        className,
      )}
      ref={line}
      role="status"
    >
      {shown.settled || (shown.interim && quiet === "Listening…") ? (
        <span className="shrink-0" ref={words}>
          {shown.settled}
          {shown.settled && shown.interim ? " " : ""}
          <span className="text-muted-foreground">{shown.interim}</span>
        </span>
      ) : (
        <span className="truncate text-muted-foreground">{quiet}</span>
      )}
    </span>
  );
}

/**
 * Dictation for a plain text field: the words go at the end of `value`, on a
 * line of their own, and nothing typed meanwhile is lost. With `maxLength`,
 * words that don't fit are cut at the limit and a toast says so. The form
 * reads `isDictating(phase)` to hold its submit until the words land.
 */
export function useDictatedText({
  maxLength,
  onChange,
  surface,
  value,
}: {
  maxLength?: number;
  onChange: (value: string) => void;
  surface: DictationSurface;
  value: string;
}): Dictation {
  // The words land after any typing done while they were transcribed.
  const latest = useRef({ onChange, value });
  useLayoutEffect(() => {
    latest.current = { onChange, value };
  });
  return useDictation({
    onText: (text) => {
      const { onChange: change, value: current } = latest.current;
      if (maxLength === undefined) {
        change(appendDictatedText(current, text));
        return;
      }
      const fitted = appendDictatedTextWithin(current, text, maxLength);
      change(fitted.text);
      if (fitted.trimmed) {
        toast.info("Some of what you said didn't fit", {
          description: `This box holds up to ${maxLength.toLocaleString("en-US")} characters, so the rest was left out.`,
        });
      }
    },
    surface,
  });
}

/**
 * A textarea with dictation along its foot, inside the box: the microphone at
 * the right, and while recording, the words being heard along the foot with
 * the wave, Cancel and Stop together at its right. What is already in the box stays, editable, and gets the new
 * words after it.
 */
export function DictatedTextarea({
  className,
  dictation,
  ...props
}: React.ComponentProps<typeof Textarea> & { dictation: Dictation }) {
  return (
    <div className="relative">
      <Textarea className={cn("pb-10", className)} {...props} />
      <div className="pointer-events-none absolute inset-x-2 bottom-1.5 flex items-center gap-2 [&>*]:pointer-events-auto">
        <DictationReadout dictation={dictation} />
        <DictationControls
          className="ml-auto"
          dictation={dictation}
          disabled={props.disabled}
          size="sm"
        />
      </div>
    </div>
  );
}
