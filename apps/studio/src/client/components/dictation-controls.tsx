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
  appendDictatedTextWithin,
  formatDictationClock,
} from "@/client/lib/dictation-text";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { type DictationSurface } from "@/shared/dictation";
import { MicrophoneIcon } from "@phosphor-icons/react/Microphone";
import { StopIcon } from "@phosphor-icons/react/Stop";
import { useLayoutEffect, useRef } from "react";

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
 * "Finishing…" while the live stream settles its last words, or
 * "Transcribing…" while the whole take is. The clock holds the recording's
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
            <span className="truncate">
              {phase.kind === "transcribing" && phase.live
                ? "Finishing…"
                : "Transcribing…"}
            </span>
          )}
        </>
      )}
    </div>
  );
}

/**
 * What a box shows in place of its words while dictating: the words the live
 * stream has heard, as they will land, with the stretch still being heard
 * fainter after them. It is read-only, so what lands is what was shown. When
 * the stream goes away or never opens, the recording goes on and a line says
 * the words will come at Stop.
 */
export function DictationPreview({
  className,
  dictation,
}: {
  className?: string;
  dictation: Dictation;
}) {
  const { live, phase } = dictation;
  if (!isDictating(phase)) {
    return null;
  }
  const settled = live?.settled ?? "";
  const interim = live?.interim ?? "";
  const note =
    live?.status === "lost"
      ? "Live text paused, but you're still recording. Your words will appear when you stop."
      : live?.status === "unavailable"
        ? "Live text isn't available right now, so your words will appear when you stop."
        : undefined;
  return (
    <div
      aria-live="polite"
      className={cn(
        "flex min-h-12 flex-col gap-1 text-sm break-words whitespace-pre-wrap",
        className,
      )}
      data-testid="dictation-preview"
    >
      <p className="min-h-6">
        {settled || interim ? (
          <>
            {settled}
            {settled && interim ? " " : ""}
            <span className="text-muted-foreground">{interim}</span>
          </>
        ) : (
          <span className="text-muted-foreground">
            {note ? "Recording…" : "Listening…"}
          </span>
        )}
      </p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
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
 * the right, and while recording, Cancel and the meter at the left. While
 * dictating, the box shows the words being heard in place of its own, which
 * it keeps and gets the new words after.
 */
export function DictatedTextarea({
  className,
  dictation,
  ...props
}: React.ComponentProps<typeof Textarea> & { dictation: Dictation }) {
  const dictating = isDictating(dictation.phase);
  return (
    <div className="relative">
      <Textarea
        className={cn(
          "pb-10",
          dictating && "text-transparent placeholder:text-transparent",
          className,
        )}
        {...props}
        readOnly={dictating || props.readOnly}
      />
      {dictating && (
        <DictationPreview
          className="pointer-events-none absolute inset-x-0 top-0 bottom-10 min-h-0 overflow-y-auto px-3 py-2"
          dictation={dictation}
        />
      )}
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
