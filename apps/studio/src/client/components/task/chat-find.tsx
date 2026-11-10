import {
  ACTIVE_MATCH_COLOR,
  findRanges,
  MATCH_COLOR,
} from "@/client/components/document-viewers/use-find-highlights";
import { FindRow } from "@/client/components/find-row";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/client/components/ui/popover";
import { useMessageScroller } from "@/client/components/ui/message-scroller";
import { useFindTarget } from "@/client/hooks/use-find-target";
import { rpcClient } from "@/client/rpc/client";
import {
  type ChatId,
  type StoreId,
  type TurnMatches,
} from "@instrument-org/workspace/client";
import { skipToken, useQuery } from "@tanstack/react-query";
import {
  type RefObject,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  findReadout,
  type FindStep,
  stepFind,
  unloadedMatches,
} from "./chat-find-steps";

/** How long typing rests before the turns not loaded yet are searched. */
const SEARCH_REST_MS = 150;

/** How many frames a loaded turn has to be drawn before the find gives up on it. */
const DRAW_WAIT_FRAMES = 120;

/**
 * Find in a chat's transcript: the shared {@link FindRow} in a card at the
 * top right of the transcript, as the browser's find stands over a page.
 *
 * What is drawn is searched where it is drawn, painted with the CSS Custom
 * Highlight API so React's DOM is never touched. A chat loads from its end, so
 * the turns above what is drawn are searched in the records
 * (`message.find`), counted in the readout above the drawn matches, and
 * loaded when a step reaches one. Work folded behind a Worked row is not
 * searched until it is opened, as it is not on screen.
 *
 * While the card is up the transcript stops following the end (the
 * conversation reads `open`), so a match stepped to stays where it is put.
 */
export function ChatFind({
  chatId,
  contentRef,
  hasOlder,
  loadOlderThrough,
  loadedIds,
  onClose,
  onOpenChange,
  open,
  sessionId,
  surfaceRef,
}: {
  chatId: ChatId;
  /** The transcript's content, which is what is searched. */
  contentRef: RefObject<HTMLElement | null>;
  hasOlder: boolean;
  loadOlderThrough: (id: StoreId.Message) => Promise<boolean>;
  /** The messages the transcript holds. */
  loadedIds: ReadonlySet<string>;
  /** Closed from the card, with the keyboard in its field: where it goes next. */
  onClose: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  sessionId: StoreId.Session;
  /** The conversation, which Cmd+F means while the keyboard is in it. */
  surfaceRef: RefObject<HTMLElement | null>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [rested, setRested] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setRested(query);
    }, SEARCH_REST_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);
  const searched = open ? query : "";

  const { data: found } = useQuery({
    ...rpcClient.workspace.message.find.queryOptions({
      input:
        open && hasOlder && rested !== "" && rested === query
          ? { id: chatId, query: rested, sessionId }
          : skipToken,
    }),
  });
  const isSearchingUnloaded = open && hasOlder && query !== "";
  const unloaded = unloadedMatches(
    isSearchingUnloaded ? found : undefined,
    loadedIds,
  );
  // No count until the turns not loaded have been searched for these words.
  const isCounting =
    query === "" ||
    rested !== query ||
    (isSearchingUnloaded && found === undefined);

  const { releaseAutoScroll, scrollToMessage } = useMessageScroller();
  const [ranges, setRanges] = useState<Range[]>([]);
  const [active, setActive] = useState(0);
  const activeRange = useRef<Range | undefined>(undefined);
  // A step running, which loads turns: one at a time.
  const stepping = useRef(false);
  const [isStepping, setIsStepping] = useState(false);
  const latestQuery = useRef(searched);
  useLayoutEffect(() => {
    activeRange.current = ranges[Math.min(active, ranges.length - 1)];
    latestQuery.current = searched;
  });

  const reveal = (range: Range | undefined) => {
    const viewport = contentRef.current?.closest<HTMLElement>(
      '[data-slot="message-scroller-viewport"]',
    );
    if (!range || !viewport) {
      return;
    }
    releaseAutoScroll();
    const jump = centeringJump(range, viewport);
    if (jump) {
      scrollToMessage(jump.messageId, {
        align: "start",
        scrollMargin: jump.margin,
      });
    }
  };

  const revealOnSearch = useEffectEvent(reveal);
  const keptActive = useEffectEvent(() => activeRange.current);

  // A new search starts at the first match from the top of what is in view,
  // as a browser's does, and every change to what is drawn keeps the match
  // the find stands on.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || searched === "") {
      setRanges([]);
      setActive(0);
      return;
    }
    const viewport = content.closest<HTMLElement>(
      '[data-slot="message-scroller-viewport"]',
    );
    const first = findRanges(content, searched);
    const at = firstInView(first, viewport);
    setRanges(first);
    setActive(at);
    revealOnSearch(first[at]);

    let frame = 0;
    const update = () => {
      const next = findRanges(content, searched);
      setRanges(next);
      setActive(keptPlace(next, keptActive()));
    };
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    });
    observer.observe(content, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [contentRef, searched]);

  const run = async (step: FindStep) => {
    if (step.kind === "none") {
      return;
    }
    if (step.kind === "drawn") {
      setActive(step.index);
      reveal(ranges[step.index]);
      return;
    }
    const content = contentRef.current;
    if (!content || stepping.current) {
      return;
    }
    stepping.current = true;
    setIsStepping(true);
    const words = latestQuery.current;
    const before = ranges[0]?.cloneRange();
    try {
      if (await loadOlderThrough(step.turn.id)) {
        await drawn(content, step.turn.id);
      }
      if (latestQuery.current !== words) {
        return;
      }
      const next = findRanges(content, words);
      const at = pickAfterLoad(next, step.pick, before);
      setRanges(next);
      setActive(at);
      reveal(next[at]);
    } finally {
      stepping.current = false;
      setIsStepping(false);
    }
  };
  const step = (forward: boolean) => {
    void run(
      stepFind({
        active: Math.min(active, Math.max(ranges.length - 1, 0)),
        drawn: ranges.length,
        forward,
        unloaded,
      }),
    );
  };

  // With nothing drawn to stand on, the find goes up to the nearest match
  // above, as soon as the records say there is one.
  const jumpedFor = useRef("");
  const nearest = unloaded.at(-1);
  const jumpUp = useEffectEvent((turn: TurnMatches) => {
    void run({ kind: "load", pick: "last", turn });
  });
  useEffect(() => {
    if (
      isStepping ||
      ranges.length > 0 ||
      nearest === undefined ||
      searched === "" ||
      jumpedFor.current === searched
    ) {
      return;
    }
    jumpedFor.current = searched;
    jumpUp(nearest);
  }, [isStepping, nearest, ranges.length, searched]);

  // Painted as two highlights per instance: one window can hold a chat in
  // several tabs, and the registry is the document's.
  const instanceId = useId().replaceAll(/[^\da-z]/gi, "");
  const matchName = `chat-find-${instanceId}`;
  const activeName = `chat-find-active-${instanceId}`;
  const current = ranges[Math.min(active, ranges.length - 1)];
  useEffect(() => {
    if (ranges.length === 0) {
      return;
    }
    const matches = new Highlight();
    for (const range of ranges) {
      matches.add(range);
    }
    CSS.highlights.set(matchName, matches);
    if (current) {
      CSS.highlights.set(activeName, new Highlight(current));
    }
    return () => {
      CSS.highlights.delete(matchName);
      CSS.highlights.delete(activeName);
    };
  }, [activeName, current, matchName, ranges]);

  // A card coming up takes the keyboard as it mounts (`onOpenAutoFocus`),
  // so only one already up is given it here: selecting a frame later would
  // take whatever was typed in between.
  const openFind = () => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      onOpenChange(true);
    }
  };
  useFindTarget({
    anchor: surfaceRef,
    findAgain: (forward) => {
      if (query === "") {
        openFind();
        return;
      }
      onOpenChange(true);
      if (open) {
        step(forward);
      }
    },
    // The card is portalled out of the conversation, so a press with the
    // caret in its field is the conversation's too.
    holdsKeyboard: () => document.activeElement === inputRef.current,
    openFind,
  });

  const readout = findReadout({ active, drawn: ranges.length, unloaded });
  return (
    <>
      <style>
        {`::highlight(${matchName}) { background-color: ${MATCH_COLOR}; }\n` +
          `::highlight(${activeName}) { background-color: ${ACTIVE_MATCH_COLOR}; }`}
      </style>
      <Popover open={open}>
        <PopoverAnchor asChild>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-0"
          />
        </PopoverAnchor>
        <PopoverContent
          align="end"
          // The transcript runs to the window's edge: inside it by the
          // scrollbar's width, as the bottom fade is.
          alignOffset={12}
          className="w-90 p-1.5"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
          }}
          onInteractOutside={(event) => {
            event.preventDefault();
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
            inputRef.current?.select();
          }}
          sideOffset={8}
        >
          <FindRow
            activeMatch={readout.activeMatch}
            inputRef={inputRef}
            matchCount={isCounting ? null : readout.matchCount}
            onClose={() => {
              const hadKeyboard = document.activeElement === inputRef.current;
              onOpenChange(false);
              if (hadKeyboard) {
                onClose();
              }
            }}
            onNextMatch={() => {
              step(true);
            }}
            onPreviousMatch={() => {
              step(false);
            }}
            onQueryChange={setQuery}
            placeholder="Find in chat"
            query={query}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}

/** The first match whose bottom is below the top of the view, else the last. */
function firstInView(ranges: readonly Range[], viewport: HTMLElement | null) {
  if (!viewport || ranges.length === 0) {
    return 0;
  }
  const top = viewport.getBoundingClientRect().top;
  const at = ranges.findIndex(
    (range) => range.getBoundingClientRect().bottom > top,
  );
  return at === -1 ? ranges.length - 1 : at;
}

/** Where the match the find stood on is among matches found again. */
function keptPlace(ranges: readonly Range[], was: Range | undefined): number {
  if (!was || ranges.length === 0) {
    return 0;
  }
  const at = ranges.findIndex(
    (range) => range.compareBoundaryPoints(Range.START_TO_START, was) >= 0,
  );
  return at === -1 ? ranges.length - 1 : at;
}

/**
 * The match a step lands on once the turns it reached are drawn: the first
 * of all, the last of all, or the last one above where the find stood. With
 * none above that (the records counted a match the drawn words do not have),
 * it wraps round to the last.
 */
function pickAfterLoad(
  ranges: readonly Range[],
  pick: "before" | "first" | "last",
  before: Range | undefined,
): number {
  if (ranges.length === 0 || pick === "first") {
    return 0;
  }
  if (pick === "last" || !before) {
    return ranges.length - 1;
  }
  const at = ranges.findLastIndex(
    (range) => range.compareBoundaryPoints(Range.START_TO_START, before) < 0,
  );
  return at === -1 ? ranges.length - 1 : at;
}

/** Waits for the scroller to draw the turn `id` opens, a frame at a time. */
async function drawn(content: HTMLElement, id: string) {
  const selector = `[data-message-id="${CSS.escape(id)}"]`;
  for (let frame = 0; frame < DRAW_WAIT_FRAMES; frame++) {
    if (content.querySelector(selector)) {
      return;
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

/**
 * How to center a match in the transcript's view, unless it is in view
 * already: the message item at or above it, and the margin above that item
 * which puts the match at the middle. Made through the scroller, not by
 * setting `scrollTop`, so the scroller holds the view there when turns load
 * above it rather than putting back where the reader was before. Rects are
 * on-screen px and margins layout px, so distances are divided by the zoom
 * the viewport is drawn at.
 */
function centeringJump(
  range: Range,
  viewport: HTMLElement,
): undefined | { margin: number; messageId: string } {
  const rect = range.getBoundingClientRect();
  const view = viewport.getBoundingClientRect();
  if (
    (rect.width === 0 && rect.height === 0) ||
    (rect.top >= view.top && rect.bottom <= view.bottom)
  ) {
    return undefined;
  }
  // A turn's work and replies are an item of their own with no message id
  // when the person's message opens it, so it is reached from that message.
  const node = range.startContainer;
  let item = (node instanceof Element ? node : node.parentElement)?.closest(
    "[data-message-scroller-item]",
  );
  while (item && !(item instanceof HTMLElement && item.dataset.messageId)) {
    item = item.previousElementSibling;
  }
  const messageId =
    item instanceof HTMLElement ? item.dataset.messageId : undefined;
  if (!item || messageId === undefined) {
    return undefined;
  }
  const scale =
    viewport.offsetHeight > 0 ? view.height / viewport.offsetHeight : 1;
  const offset = (rect.top - item.getBoundingClientRect().top) / scale;
  return {
    margin: viewport.clientHeight / 2 - offset - rect.height / scale / 2,
    messageId,
  };
}
