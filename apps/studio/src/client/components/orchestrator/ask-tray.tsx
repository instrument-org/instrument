import { InstrumentGlyph } from "@/client/components/wordmark";
import { cn } from "@/client/lib/utils";
import { XIcon } from "@phosphor-icons/react/X";
import { useAtom } from "jotai";
import { useEffect, useRef, useState } from "react";

import { AskNumber } from "./ask-pills";
import {
  askTrayAtom,
  numbered,
  revealAsk,
  useFileAsks,
  useMoveAsks,
  useStagedAskActions,
} from "./staged-asks";

/** How many numbers the folded tray shows before it says how many more. */
const FOLDED_NUMBERS = 5;
/** How long the pointer rests off the tray before a list it opened folds. */
const FOLD_DELAY_MS = 250;

/**
 * The asks marked in a file and not yet moved into a chat, floating at the
 * foot of the file over its content: their count and numbers, folded, and
 * the list of them unfolded on a press or while the pointer rests on it,
 * each pressed to bring its place into view or taken out with its x. One
 * button moves them all into a composer as pills; nothing is typed or sent
 * here. Absent while nothing waits.
 */
export function AskTray({ path }: { path: string }) {
  const waiting = numbered(useFileAsks(path)).filter(
    ({ ask }) => ask.destination === undefined,
  );
  const { remove } = useStagedAskActions();
  const { canMove, label, move } = useMoveAsks();
  const [tray, setTray] = useAtom(askTrayAtom);
  const [isHovered, setHovered] = useState(false);
  const foldTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(foldTimer.current);
    },
    [],
  );
  if (waiting.length === 0) {
    return null;
  }
  const isPinnedOpen = tray === path;
  const isOpen = isPinnedOpen || isHovered;
  const shown = waiting.slice(0, FOLDED_NUMBERS);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div
        className="pointer-events-auto flex max-w-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
        data-slot="ask-tray"
        onMouseEnter={() => {
          clearTimeout(foldTimer.current);
          setHovered(true);
        }}
        onMouseLeave={() => {
          foldTimer.current = setTimeout(() => {
            setHovered(false);
          }, FOLD_DELAY_MS);
        }}
      >
        {isOpen && (
          <ol className="flex max-h-72 w-96 max-w-full flex-col gap-0.5 overflow-y-auto border-b border-border p-1.5">
            {waiting.map(({ ask, n }) => (
              <li
                className="group/ask flex items-start gap-1 rounded-lg hover:bg-muted"
                key={ask.id}
              >
                <button
                  className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left"
                  onClick={() => {
                    revealAsk(ask);
                  }}
                  type="button"
                >
                  <AskNumber className="mt-0.5" n={n} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
                      <span className="shrink-0 font-medium">{ask.target}</span>
                      <span className="min-w-0 truncate text-muted-foreground">
                        {ask.instruction}
                      </span>
                    </span>
                    {ask.excerpt && (
                      <span className="truncate font-mono text-[11px] text-muted-foreground/80">
                        {ask.excerpt.replaceAll(/\s+/g, " ")}
                      </span>
                    )}
                  </span>
                </button>
                <button
                  aria-label={`Remove ask ${n}`}
                  className="mt-1 mr-1 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-60 group-hover/ask:opacity-100 hover:bg-foreground/8 hover:text-foreground"
                  onClick={() => {
                    remove([ask.id]);
                  }}
                  type="button"
                >
                  <XIcon className="size-3.5" />
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="flex h-11 min-w-0 items-center gap-2 pr-1.5 pl-2">
          <button
            aria-expanded={isOpen}
            className={cn(
              "flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-[13px] font-medium hover:bg-muted",
              isPinnedOpen && "bg-muted",
            )}
            onClick={() => {
              setTray(isPinnedOpen ? null : path);
            }}
            type="button"
          >
            <InstrumentGlyph
              className="size-3.5 shrink-0 text-brand-600 dark:text-brand-400"
              size={14}
            />
            <span className="shrink-0">
              {waiting.length === 1 ? "1 ask" : `${waiting.length} asks`}
            </span>
            <span className="flex min-w-0 items-center gap-1">
              {shown.map(({ ask, n }) => (
                <AskNumber key={ask.id} n={n} />
              ))}
              {waiting.length > shown.length && (
                <span className="text-xs text-muted-foreground">
                  +{waiting.length - shown.length}
                </span>
              )}
            </span>
          </button>
          {canMove && (
            <button
              className="h-8 shrink-0 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => {
                setTray(null);
                setHovered(false);
                move(waiting.map(({ ask }) => ask.id));
              }}
              type="button"
            >
              {label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
