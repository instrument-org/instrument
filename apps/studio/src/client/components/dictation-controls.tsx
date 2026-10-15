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
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { type DictationSurface } from "@/shared/dictation";
import { MicrophoneIcon } from "@phosphor-icons/react/Microphone";
import { StopIcon } from "@phosphor-icons/react/Stop";
import { XIcon } from "@phosphor-icons/react/X";
import { useLayoutEffect, useRef, useState } from "react";

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
            aria-label={working ? "Adding your words" : "Stop"}
            className={cn(
              box,
              "shrink-0 rounded-full bg-foreground p-0 text-background hover:bg-foreground/85 disabled:opacity-100",
              className,
            )}
            disabled={working}
            onClick={() => {
              dictation.stop();
            }}
          >
            {working && phase.pressed === "stop" ? (
              <Spinner className={icon} delay={0} />
            ) : (
              <StopIcon className="size-3.5" weight="fill" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Stop and add your words</p>
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
 * Throws the recording away, as a round ✕ at the bar's left. Only while there
 * is audio to lose: once it has been sent there is nothing here to discard,
 * so it goes invisible but keeps its place, and nothing beside it moves as
 * the words land.
 */
export function DictationCancel({
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
        <p>Cancel and discard the recording</p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The words being heard, on one line: settled words in full, the stretch
 * still being heard fainter after them. Once the line is full it keeps the
 * newest words in view and fades the start out, so it never grows and nothing
 * around it moves. Before any words it says it is listening; when live text
 * is unavailable it says the words will come at Stop instead.
 */
export function DictationReadout({
  className,
  dictation,
}: {
  className?: string;
  dictation: Dictation;
}) {
  const { live, phase } = dictation;
  const line = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const settled = live?.settled ?? "";
  const interim = live?.interim ?? "";
  useLayoutEffect(() => {
    const element = line.current;
    setOverflowing(
      element !== null && element.scrollWidth > element.clientWidth,
    );
  }, [settled, interim]);
  if (!isDictating(phase)) {
    return null;
  }
  const quiet =
    live?.status === "lost" || live?.status === "unavailable"
      ? "Live text isn't available, so your words will appear when you stop."
      : phase.kind === "transcribing" && !phase.live
        ? "Adding your words…"
        : "Listening…";
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
      {(settled || interim) && quiet === "Listening…" ? (
        <span className="shrink-0">
          {settled}
          {settled && interim ? " " : ""}
          <span className="text-muted-foreground">{interim}</span>
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
 * the right, and while recording, Cancel and the words being heard along
 * the foot. What is already in the box stays, read-only, and gets the new
 * words after it.
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
        className={cn("pb-10", className)}
        {...props}
        readOnly={dictating || props.readOnly}
      />
      <div className="pointer-events-none absolute inset-x-2 bottom-1.5 flex items-center gap-2 [&>*]:pointer-events-auto">
        <DictationCancel dictation={dictation} size="sm" />
        <DictationReadout dictation={dictation} />
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

/**
 * Send, saying while dictating that it stops first: the words land, then the
 * message goes.
 */
export function DictationSendTip({
  children,
  dictation,
}: {
  children: React.ReactElement;
  dictation: Dictation;
}) {
  if (!isDictating(dictation.phase)) {
    return children;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        <p>Stop and send</p>
      </TooltipContent>
    </Tooltip>
  );
}
