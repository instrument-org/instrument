import { Button } from "@/client/components/ui/button";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { type Icon } from "@phosphor-icons/react";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { type ReactNode, useState } from "react";

/** How many rows a card shows before the rest wait behind Show more. */
export const SHOWN_ROWS = 5;

/**
 * A card's Undo: whether it is undone (here, or already, on this device or
 * another), whether one is running, and the click. `said` is the toast for
 * everything put back and for all but what the person changed since.
 */
export function useChangeCardUndo({
  call,
  said,
  undoneBefore,
}: {
  call: () => Promise<{ skipped: number; undone: number }>;
  said: { all: string; some: string };
  undoneBefore: boolean;
}) {
  const [undoing, setUndoing] = useState(false);
  const [undoneHere, setUndone] = useState(false);
  const undo = () => {
    setUndoing(true);
    return call()
      .then(({ skipped, undone: count }) => {
        if (count === 0) {
          toast.info("There was nothing left to undo.");
          return;
        }
        setUndone(true);
        toast.success(skipped === 0 ? said.all : said.some);
      })
      .catch((error: unknown) => {
        toast.error("Couldn't undo that", { cause: error });
      })
      .finally(() => {
        setUndoing(false);
      });
  };
  return { undo, undone: undoneBefore || undoneHere, undoing };
}

/**
 * What a turn changed of one kind, as a card under the reply: a gray icon
 * and a heading drawn from the changes, Undo where they can be taken back,
 * then a row per thing, the rest past a few behind Show more. Every card of
 * this kind is the same width, whatever its rows say.
 */
export function ChangeCard({
  children,
  heading,
  hidden = 0,
  icon: HeadIcon,
  onShowMore,
  slot,
  undo,
  undone = false,
}: {
  children: ReactNode;
  heading: string;
  /** How many rows wait behind Show more. */
  hidden?: number;
  icon: Icon;
  onShowMore?: () => void;
  slot: string;
  /** Absent where the changes cannot be taken back, or none still stands. */
  undo?: { busy: boolean; onUndo: () => void };
  undone?: boolean;
}) {
  return (
    <div
      className={cn(
        "mt-3 w-full max-w-115 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)]",
        undone && "bg-muted/40",
      )}
      data-slot={slot}
    >
      <div className="flex h-11 items-center gap-2 border-b border-border/70 px-4">
        <span className="flex h-5 w-4 shrink-0 items-center justify-center">
          <HeadIcon className="size-4 text-muted-foreground" />
        </span>
        <span
          className={cn(
            "flex-1 truncate text-sm leading-5 font-medium",
            undone ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {heading}
        </span>
        {undone ? (
          <span className="-mr-1.5 flex h-7 items-center gap-1 px-2 text-xs text-muted-foreground">
            <CheckIcon className="size-3" />
            Undone
          </span>
        ) : (
          undo && (
            <Button
              className="-mr-1.5 h-7 gap-1 px-2 text-xs text-muted-foreground"
              disabled={undo.busy}
              onClick={undo.onUndo}
              size="sm"
              variant="ghost"
            >
              <ArrowCounterClockwiseIcon className="size-3" />
              Undo
            </Button>
          )
        )}
      </div>
      <ul className="divide-y divide-border/60 px-4">{children}</ul>
      {hidden > 0 && onShowMore && (
        <button
          className="w-full border-t border-border/60 px-4 py-2.5 text-left text-xs text-muted-foreground hover:text-foreground"
          onClick={onShowMore}
          type="button"
        >
          Show {hidden.toString()} more
        </button>
      )}
    </div>
  );
}

/**
 * One thing a card names: its mark, its name (opening it while it is still
 * there), and a line for each change. `quiet` is for a thing gone or put
 * back, and `struck` strikes its lines through once the card is undone.
 */
export function ChangeRow({
  lead,
  lines,
  name,
  onOpen,
  quiet = false,
  struck = false,
}: {
  lead: ReactNode;
  lines: readonly { key: string; words: ReactNode }[];
  name: ReactNode;
  onOpen?: () => void;
  quiet?: boolean;
  struck?: boolean;
}) {
  const nameClassName = cn(
    "min-w-0 truncate text-sm leading-5",
    quiet ? "text-muted-foreground" : "text-foreground",
  );
  return (
    <li className="py-3">
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center",
            quiet && "opacity-50",
          )}
        >
          {lead}
        </span>
        {onOpen ? (
          <button
            className={cn(nameClassName, "text-left hover:underline")}
            onClick={onOpen}
            type="button"
          >
            {name}
          </button>
        ) : (
          <span className={nameClassName}>{name}</span>
        )}
      </span>
      <span className="mt-1 flex flex-col gap-0.5 pl-7">
        {lines.map((line) => (
          <span
            className={cn(
              "min-w-0 truncate text-xs leading-5",
              struck && "line-through",
              quiet ? "text-muted-foreground/80" : "text-muted-foreground",
            )}
            key={line.key}
          >
            {line.words}
          </span>
        ))}
      </span>
    </li>
  );
}

/** A row's glyph, where the thing has no mark of its own. */
export function RowGlyph({ icon: RowIcon }: { icon: Icon }) {
  return <RowIcon className="size-3.75 text-muted-foreground/80" />;
}
