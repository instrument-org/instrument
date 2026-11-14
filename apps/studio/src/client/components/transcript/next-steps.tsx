import { ArrowBendDownRightIcon } from "@phosphor-icons/react/ArrowBendDownRight";
import { createContext, use, useLayoutEffect, useRef } from "react";

import { MESSAGE_FOOTER_ICON_SIZE } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { ShortcutKeys } from "../shortcut-keys";
import { useMessageScroller } from "../ui/message-scroller";

/** What a chat suggests the person send next, and how one is sent. */
export interface NextSteps {
  /**
   * The reply box has nothing in it, so the command key with Enter sends the
   * first line: its keys show beside it. With words in the box that chord
   * sends those, and the rows step back.
   */
  isBoxEmpty: boolean;
  /** The suggested messages, likeliest first. */
  lines: readonly string[];
  onSend: (line: string) => void;
}

/** Given by a chat around its own transcript; a transcript without one suggests nothing. */
export const NextStepsContext = createContext<NextSteps | undefined>(undefined);

/** Whether the chat has next steps to draw under its last reply. */
export function useHasNextSteps(): boolean {
  return (use(NextStepsContext)?.lines.length ?? 0) > 0;
}

/**
 * The chat's suggested next messages, as rows under its last reply's footer:
 * each row's arrow stands under the footer's copy button, and a press sends
 * the row as the person's message.
 */
export function NextStepRows() {
  const steps = use(NextStepsContext);
  if (!steps || steps.lines.length === 0) {
    return null;
  }
  return <Rows {...steps} />;
}

function Rows({ isBoxEmpty, lines, onSend }: NextSteps) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollToEnd } = useMessageScroller();
  // The rows arrive a moment after the reply they follow, once nothing is
  // following the transcript. A reader who was at the end stays there, so
  // the rows never land under the fold; one who had scrolled away is left
  // where they are, with the rows growing below what they are reading.
  // Rows that land inside the window are left alone: the room the scroller
  // leaves under a message just sent counts toward the end, and taking the
  // end there would collapse it and drop the message down the window.
  useLayoutEffect(() => {
    const rows = ref.current;
    const viewport = rows?.closest<HTMLElement>(
      '[data-slot="message-scroller-viewport"]',
    );
    if (!rows || !viewport) {
      return;
    }
    const gap = rows.parentElement
      ? Number.parseFloat(getComputedStyle(rows.parentElement).rowGap) || 0
      : 0;
    const below =
      viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    const underFold =
      rows.getBoundingClientRect().bottom -
        viewport.getBoundingClientRect().bottom >
      1;
    if (underFold && below - rows.offsetHeight - gap <= 1) {
      scrollToEnd();
    }
    // Once, as the rows arrive.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      aria-label="Suggested next messages"
      className={cn(
        "flex animate-in flex-col items-start transition-opacity duration-150 fade-in-0",
        !isBoxEmpty && "opacity-60 hover:opacity-100",
      )}
      ref={ref}
      role="group"
    >
      {lines.map((line, index) => (
        <button
          className="group/next-step -mx-1 flex h-7 max-w-full items-center gap-1 text-left text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
          key={line}
          onClick={() => {
            onSend(line);
          }}
          // The reply box keeps the caret: a press here never takes focus.
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          type="button"
        >
          {/* The footer's copy button is this box: its padding, its icon size. */}
          <span className="shrink-0 p-1 text-muted-foreground/60 group-hover/next-step:text-foreground/70">
            <ArrowBendDownRightIcon size={MESSAGE_FOOTER_ICON_SIZE} />
          </span>
          <span className="min-w-0 truncate rounded-md px-1.5 py-0.5 group-hover/next-step:bg-muted/50 group-focus-visible/next-step:bg-muted/50">
            {line}
          </span>
          {index === 0 && isBoxEmpty && (
            <span className="shrink-0 opacity-80">
              <ShortcutKeys accelerator="CmdOrCtrl+Enter" />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
