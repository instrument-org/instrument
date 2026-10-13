import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { Textarea } from "@/client/components/ui/textarea";
import {
  type Dictation,
  isDictating,
  useDictation,
} from "@/client/hooks/use-dictation";
import {
  appendDictatedText,
  formatDictationClock,
} from "@/client/lib/dictation-text";
import { cn } from "@/client/lib/utils";
import { type DictationSurface } from "@/shared/dictation";
import { MicrophoneIcon } from "@phosphor-icons/react/Microphone";
import { StopIcon } from "@phosphor-icons/react/Stop";

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
      <Button
        aria-label={working ? "Transcribing" : "Stop and transcribe"}
        className={cn(
          box,
          "shrink-0 rounded-full p-0 disabled:opacity-100",
          className,
        )}
        disabled={working}
        onClick={() => {
          dictation.stop();
        }}
        variant="destructive"
      >
        {working && phase.pressed === "stop" ? (
          <Spinner className={icon} delay={0} />
        ) : (
          <StopIcon className={icon} weight="fill" />
        )}
      </Button>
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
 * Throws the recording away. Only while there is audio to lose: once it has
 * been sent there is nothing here to discard, so it goes invisible but keeps
 * its place, and nothing beside it moves as the words are transcribed.
 */
export function DictationCancel({
  className,
  dictation,
}: {
  className?: string;
  dictation: Dictation;
}) {
  const { phase } = dictation;
  if (!isDictating(phase)) {
    return null;
  }
  const spent = phase.kind === "transcribing";
  return (
    <Button
      aria-hidden={spent}
      className={cn(
        "shrink-0 text-muted-foreground",
        spent && "invisible",
        className,
      )}
      disabled={spent}
      onClick={dictation.cancel}
      size="xs"
      variant="ghost"
    >
      Cancel
    </Button>
  );
}

/**
 * The red dot, the clock, and the level bars while recording; the clock and
 * "Transcribing…" once it has been sent. The clock holds the recording's
 * length while it is transcribed.
 */
export function DictationMeter({
  className,
  dictation,
}: {
  className?: string;
  dictation: Dictation;
}) {
  const { elapsedMs, levels, phase } = dictation;
  if (!isDictating(phase)) {
    return null;
  }
  return (
    <div
      className={cn(
        "flex h-5 min-w-0 items-center gap-2 text-xs",
        phase.kind === "transcribing"
          ? "text-muted-foreground"
          : "text-destructive",
        className,
      )}
      role="status"
    >
      {phase.kind !== "transcribing" && (
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-destructive" />
      )}
      {phase.kind === "starting" ? (
        <span className="truncate">Starting…</span>
      ) : (
        <>
          <span className="font-mono tabular-nums">
            {formatDictationClock(elapsedMs)}
          </span>
          {phase.kind === "recording" ? (
            <LevelBars levels={levels} />
          ) : (
            <span className="truncate">Transcribing…</span>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Recent microphone level as a row of bars, each already scaled to 0..1
 * against what this microphone can do (`dictation-levels.ts`). It says one
 * thing: the microphone can hear you. Bars rather than a trace, which looks
 * unsteady even when capture is fine, and rather than a filling meter, which
 * reads as progress.
 */
function LevelBars({ levels }: { levels: number[] }) {
  return (
    <div aria-hidden="true" className="flex h-5 items-center gap-0.5">
      {levels.map((level, index) => (
        <span
          className="w-0.5 rounded-full bg-current transition-all duration-100 ease-out"
          key={index}
          style={{
            height: `${3 + level * 15}px`,
            opacity: 0.45 + level * 0.55,
          }}
        />
      ))}
    </div>
  );
}

/**
 * A textarea with dictation along its foot, inside the box: the microphone at
 * the right, and while recording, Cancel and the meter at the left. Dictated
 * words go at the end, on a line of their own, and nothing typed meanwhile is
 * lost.
 */
export function DictatedTextarea({
  className,
  onDictated,
  surface,
  ...props
}: React.ComponentProps<typeof Textarea> & {
  /** The words, for the field to append with `appendDictatedText`. */
  onDictated: (append: (existing: string) => string) => void;
  surface: DictationSurface;
}) {
  const dictation = useDictation({
    onText: (text) => {
      onDictated((existing) => appendDictatedText(existing, text));
    },
    surface,
  });
  return (
    <div className="relative">
      <Textarea className={cn("pb-10", className)} {...props} />
      <div className="pointer-events-none absolute inset-x-2 bottom-1.5 flex items-center gap-2 [&>*]:pointer-events-auto">
        <DictationCancel className="-ml-1" dictation={dictation} />
        <DictationMeter dictation={dictation} />
        <DictationButton
          className="ml-auto"
          dictation={dictation}
          disabled={props.disabled}
          size="sm"
        />
      </div>
    </div>
  );
}
