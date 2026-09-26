import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { XIcon } from "@phosphor-icons/react/X";
import { type ReactNode, useState } from "react";

import { AskPopover } from "./ask-popover";
import {
  fileNameOf,
  numbered,
  revealAsk,
  type StagedAsk,
  useStagedAskActions,
} from "./staged-asks";

/** The number an ask's marker wears in its file, as a small round badge. */
export function AskNumber({ className, n }: { className?: string; n: number }) {
  return (
    <span
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-full bg-brand-600 text-[10px] leading-none font-semibold text-white tabular-nums dark:bg-brand-500",
        className,
      )}
    >
      {n}
    </span>
  );
}

/** Staged asks as a row of chips in a composer, each numbered as its marker in its file is. */
export function AskPills({ asks }: { asks: readonly StagedAsk[] }) {
  const showFile = new Set(asks.map((ask) => ask.path)).size > 1;
  return (
    <>
      {numbered(asks).map(({ ask, n }) => (
        <AskPill ask={ask} key={ask.id} n={n} showFile={showFile} />
      ))}
    </>
  );
}

/**
 * What was marked, on the record under the message it went with: the asks
 * as chips wrapping at the right where the person's own words sit, the way
 * attached files are, each with its whole self in its tooltip.
 */
export function SentAsksNote({
  data,
}: {
  data: SessionMessageDataPart.AsksDataPart;
}) {
  const counts = new Map<string, number>();
  const showFile = new Set(data.asks.map((ask) => ask.file.path)).size > 1;
  return (
    <div className="flex flex-wrap justify-end gap-1.5" data-slot="sent-asks">
      {data.asks.map((ask, index) => {
        const n = (counts.get(ask.file.path) ?? 0) + 1;
        counts.set(ask.file.path, n);
        return (
          <AskChip
            detail={
              <AskDetail
                file={ask.file.name}
                instruction={ask.instruction}
                target={ask.target}
                {...(ask.excerpt ? { excerpt: ask.excerpt } : {})}
              />
            }
            // Sent asks never change, so their place in the list is their identity.

            key={index}
            label={
              // Focusable, so the tooltip reaches a keyboard too.
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
              <span className="min-w-0 truncate pr-1" tabIndex={0}>
                {showFile ? `${ask.file.name} · ${ask.target}` : ask.target}
              </span>
            }
            n={n}
          />
        );
      })}
    </div>
  );
}

/**
 * One ask as a chip on the surface the transcript's attached files sit on:
 * its number and where it is, short, with the rest in its tooltip, so a
 * message with many asks still takes a line or two.
 */
function AskChip({
  children,
  detail,
  label,
  n,
}: {
  /** What follows the label inside the chip: an x that takes it out. */
  children?: ReactNode;
  detail: ReactNode;
  /** Where the ask is; a button that opens it, where the chip can be opened. */
  label: ReactNode;
  n: number;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex h-7 max-w-52 min-w-0 items-center gap-1.5 rounded-lg bg-background pr-1 pl-1.5 text-xs text-foreground shadow-xs ring-1 ring-border/60"
          data-slot="ask-chip"
        >
          <AskNumber n={n} />
          {label}
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent collisionPadding={10} maxWidth="22rem">
        {detail}
      </TooltipContent>
    </Tooltip>
  );
}

/** What an ask is, in full, for the tooltip over its chip. */
function AskDetail({
  excerpt,
  file,
  instruction,
  target,
}: {
  excerpt?: string;
  file: string;
  instruction: string;
  target: string;
}) {
  return (
    <span className="flex flex-col gap-1">
      <span className="font-medium">
        {file} · {target}
      </span>
      {instruction && <span>{instruction}</span>}
      {excerpt && (
        <span className="line-clamp-4 font-mono text-[11px] whitespace-pre-wrap opacity-70">
          {excerpt}
        </span>
      )}
    </span>
  );
}

/**
 * One staged ask in a composer's attachments row. Pressed, it brings the
 * place into view in the file and opens its words to change them; its x
 * takes it out.
 */
function AskPill({
  ask,
  n,
  showFile,
}: {
  ask: StagedAsk;
  n: number;
  /** Whether the chip names its file, for a row that holds more than one. */
  showFile: boolean;
}) {
  const { remove, setInstruction } = useStagedAskActions();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const where = showFile
    ? `${fileNameOf(ask.path)} · ${ask.target}`
    : ask.target;
  return (
    <>
      <AskChip
        detail={
          <AskDetail
            file={fileNameOf(ask.path)}
            instruction={ask.instruction}
            target={ask.target}
            {...(ask.excerpt ? { excerpt: ask.excerpt } : {})}
          />
        }
        label={
          <button
            className="min-w-0 truncate pr-0.5 text-left hover:underline"
            onClick={(event) => {
              revealAsk(ask);
              setAnchor(event.currentTarget);
            }}
            type="button"
          >
            {where}
          </button>
        }
        n={n}
      >
        <button
          aria-label={`Remove comment ${n}`}
          className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
          onClick={() => {
            remove([ask.id]);
          }}
          type="button"
        >
          <XIcon className="size-3" />
        </button>
      </AskChip>
      {anchor && (
        <AskPopover
          initial={ask.instruction}
          onCancel={() => {
            setAnchor(null);
          }}
          onRemove={() => {
            remove([ask.id]);
            setAnchor(null);
          }}
          onSubmit={(instruction) => {
            setInstruction(ask.id, instruction);
            setAnchor(null);
          }}
          reference={anchor}
          submitLabel="Save"
          target={where}
        />
      )}
    </>
  );
}
