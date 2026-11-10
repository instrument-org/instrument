import { useFindTarget } from "@/client/hooks/use-find-target";
import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useFindHighlights } from "./document-viewers/use-find-highlights";
import { FindRow } from "./find-row";
import { FindScrollMarks, useRangeMarks } from "./find-scroll-marks";

type Refs = {
  contentRef: RefObject<HTMLElement | null>;
  scrollRef: RefObject<HTMLElement | null>;
};

/**
 * Cmd+F over a Markdown document, read only or open in the editor: the shared
 * {@link FindRow} in the card the code editor's find opens at the top right,
 * matches painted over the rendered text by {@link useFindHighlights} and
 * ticked down the scrollbar. Highlights are painted over live ranges rather
 * than marks in the document, so the editor's own DOM is never touched, and an
 * edit while the card is up is searched again.
 *
 * `contentRef` is the rendered document alone: the outline's rail sits in the
 * same scroll container with every heading's text in it, hidden, and searching
 * that too would count each heading twice.
 */
export function MarkdownFind({ contentRef, scrollRef }: Refs) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // The open card's step, for Cmd+G; null while it is closed or has no query.
  const stepRef = useRef<((delta: number) => void) | null>(null);

  const focusField = () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  };
  const openFind = () => {
    setOpen(true);
    focusField();
  };

  useFindTarget({
    anchor: scrollRef,
    findAgain: (forward) => {
      if (stepRef.current) {
        stepRef.current(forward ? 1 : -1);
      } else {
        openFind();
      }
    },
    openFind,
  });

  return open ? (
    <FindCard
      contentRef={contentRef}
      inputRef={inputRef}
      onClose={() => {
        setOpen(false);
      }}
      scrollRef={scrollRef}
      stepRef={stepRef}
    />
  ) : null;
}

/** Mounted only while open, so a closed find walks and paints nothing. */
function FindCard({
  contentRef,
  inputRef,
  onClose,
  scrollRef,
  stepRef,
}: Refs & {
  inputRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
  stepRef: RefObject<((delta: number) => void) | null>;
}) {
  const [query, setQuery] = useState("");
  const {
    activeMatch,
    goToMatch,
    matchCount,
    ranges,
    resetActiveMatch,
    styleSheet,
  } = useFindHighlights({ containerRef: contentRef, query });
  const marks = useRangeMarks(scrollRef, ranges, activeMatch);

  useLayoutEffect(() => {
    stepRef.current = query === "" ? null : goToMatch;
    return () => {
      stepRef.current = null;
    };
  });

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [inputRef]);

  return (
    <>
      <style>{styleSheet}</style>
      <FindScrollMarks marks={marks} />
      <div className="absolute top-2 right-4 z-30 w-90 max-w-[calc(100%-2rem)] rounded-xl bg-popover p-1.5 text-popover-foreground shadow-float-sm">
        <FindRow
          activeMatch={activeMatch + 1}
          inputRef={inputRef}
          matchCount={matchCount}
          onClose={onClose}
          onNextMatch={() => {
            goToMatch(1);
          }}
          onPreviousMatch={() => {
            goToMatch(-1);
          }}
          onQueryChange={(next) => {
            setQuery(next);
            resetActiveMatch();
          }}
          placeholder="Find in document"
          query={query}
        />
      </div>
    </>
  );
}
