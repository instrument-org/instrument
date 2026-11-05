import { Button } from "@/client/components/ui/button";
import { cn } from "@/client/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { ClockCountdownIcon } from "@phosphor-icons/react/ClockCountdown";
import { StopIcon } from "@phosphor-icons/react/Stop";
import { useState } from "react";

import { BashCommandPreview } from "../message-part/bash-command-section";
import { type CommandFacts } from "../transcript/surface";
import { formatClock, formatRoughSpan, useTicking } from "../transcript/time";

const CLOCK_TIME = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

/** When a command that starts by sleeping a number of seconds, as a timer does, is due. */
function dueAt({ command, startedAt }: CommandFacts): number | undefined {
  const seconds = /^\s*sleep\s+(\d+)(?=[\s;&|]|$)/.exec(command)?.[1];
  return seconds === undefined
    ? undefined
    : startedAt.getTime() + Number(seconds) * 1000;
}

/** A command's second line: when it ends if that is known, else how long it has run. */
function commandLine(command: CommandFacts, now: number): string {
  const started = `Started at ${CLOCK_TIME.format(command.startedAt)}`;
  if (command.ranMs !== undefined) {
    return `Command · ${started} · Ran ${formatRoughSpan(command.ranMs)}`;
  }
  const due = dueAt(command);
  return due !== undefined && due > now
    ? `Command · Ends at ${CLOCK_TIME.format(due)} · ${formatClock(due - now)} left`
    : `Command · ${started} · ${formatClock(now - command.startedAt.getTime())}`;
}

function CommandMark() {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
      <ClockCountdownIcon className="size-5 text-foreground/70" />
    </span>
  );
}

function StopButton({
  disabled,
  onStop,
}: {
  disabled?: boolean;
  onStop: () => void;
}) {
  return (
    <Button
      className="shrink-0"
      disabled={disabled}
      onClick={onStop}
      size="xs"
      variant="outline"
    >
      <StopIcon weight="fill" />
      Stop
    </Button>
  );
}

/**
 * A command that outlasted its turn, under the reply: its name and how it is
 * going, with Stop, then flat with how long it ran once it has ended.
 */
export function CommandCard({
  command,
  onStop,
}: {
  command: CommandFacts;
  onStop: () => void;
}) {
  const hasEnded = command.ranMs !== undefined;
  const now = useTicking(!hasEnded);
  return (
    <div
      className={cn(
        "flex max-w-130 items-center gap-3 rounded-2xl border p-3",
        hasEnded ? "border-transparent bg-muted/60" : "border-border bg-card",
      )}
    >
      <CommandMark />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "min-w-0 truncate text-sm",
              hasEnded && "text-muted-foreground",
            )}
          >
            {command.explanation ?? command.command}
          </span>
          {hasEnded && (
            <CheckIcon className="size-3.5 shrink-0 text-muted-foreground" />
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground tabular-nums">
          {commandLine(command, now)}
        </div>
      </div>
      {!hasEnded && <StopButton onStop={onStop} />}
    </div>
  );
}

/** A running command in the header's list: as its card, opening onto the command itself. */
export function CommandListRow({
  command,
  disabled,
  now,
  onStop,
}: {
  command: CommandFacts;
  disabled: boolean;
  now: number;
  onStop: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-3">
        <CommandMark />
        <button
          aria-expanded={isOpen}
          className="min-w-0 flex-1 text-left outline-none"
          onClick={() => {
            setIsOpen((open) => !open);
          }}
          type="button"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-sm">
              {command.explanation ?? command.command}
            </span>
            <CaretRightIcon
              className={cn(
                "size-3 shrink-0 text-muted-foreground transition duration-150",
                isOpen && "rotate-90",
              )}
            />
          </span>
          <span className="block truncate text-xs text-muted-foreground tabular-nums">
            {commandLine(command, now)}
          </span>
        </button>
        <StopButton disabled={disabled} onStop={onStop} />
      </div>
      {isOpen && (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="border-b border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
            Command
          </div>
          <BashCommandPreview
            className="p-3 text-xs"
            command={command.command}
          />
        </div>
      )}
    </li>
  );
}
