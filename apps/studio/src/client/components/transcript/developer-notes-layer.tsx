import {
  type ChatId,
  type DeveloperNote,
  type StoreId,
  type Turn,
} from "@instrument-org/workspace/client";
import { useAtomValue } from "jotai";
import { use, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { chatNotesAtom } from "@/client/atoms/chat-notes";

import { DeveloperNotesSourceContext } from "./developer-notes-source";
import STYLES from "./developer-notes-layer.css?inline";

/** How long the pointer rests on a word before its card opens. */
const CARD_OPENS_AFTER_MS = 150;
/** How long the pointer can be off both a note and its card before the card closes. */
const CARD_CLOSES_AFTER_MS = 150;
/** How long a move heading for the card ignores the notes it crosses. */
const HEADING_FOR_CARD_MS = 120;

/**
 * Where a note's 17px line starts below the top of what it sits by, so its 12px
 * words share a baseline with that row's first line. Measured per kind of row;
 * a row whose first line moves needs its number moved.
 */
const LINE_OFFSET: Record<DeveloperNote["rowKind"], number> = {
  activity: 6.5,
  ask: 19,
  bubble: 2.5,
  error: 1.5,
  note: 6.5,
  task: 13.5,
  text: 4,
};

const rowName = (row: string) => `--dn-${CSS.escape(row)}`;
const bubbleName = (row: string) => `--dn-bubble-${CSS.escape(row)}`;

interface Stack {
  key: string;
  notes: DeveloperNote[];
  row: string;
  rowKind: DeveloperNote["rowKind"];
  side: DeveloperNote["side"];
}

/** Notes beside one row on one side make one stack, in the order they happened. */
function stacksOf(notes: readonly DeveloperNote[]): Stack[] {
  const stacks = new Map<string, Stack>();
  for (const note of notes) {
    const key = `${note.side}:${note.row}`;
    const stack = stacks.get(key);
    if (stack) {
      stack.notes.push(note);
    } else {
      stacks.set(key, {
        key,
        notes: [note],
        row: note.row,
        rowKind: note.rowKind,
        side: note.side,
      });
    }
  }
  return [...stacks.values()];
}

/**
 * A row and not a step inside one: a row's first step shares its id, and the
 * last element wearing a name is the one that answers to it. A row inside the
 * Worked row is its own, so that one doesn't count.
 */
const NOT_NESTED = `:not([data-transcript-row]:not([data-transcript-row^="worked:"]) [data-transcript-row])`;

/** Names what the notes sit by, and nothing else, from outside the rows. */
function anchorRules(stacks: readonly Stack[]): string {
  const rows = new Map(stacks.map((stack) => [stack.row, stack.rowKind]));
  return [...rows]
    .map(([row, kind]) =>
      kind === "bubble"
        ? `[data-transcript-row="${row}"]{anchor-name:${rowName(row)}}[data-transcript-row="${row}"] [data-slot="user-message-content"]{anchor-name:${bubbleName(row)}}`
        : `[data-transcript-row="${row}"]${NOT_NESTED}{anchor-name:${rowName(row)}}`,
    )
    .join("\n");
}

/** `anchor(a edge, anchor(b edge, last))`: the first of these on the page. */
function firstOf(names: readonly string[], edge: string, last: string): string {
  return names.reduceRight(
    (rest, name) => `anchor(${name} ${edge}, ${rest})`,
    last,
  );
}

const namesOf = ({ row, rowKind }: Stack) =>
  rowKind === "bubble" ? [bubbleName(row), rowName(row)] : [rowName(row)];

/**
 * A stack has the margin down to the next stack on its side and no further, so
 * it can't sit on another or reach past the column's end and grow the scroller.
 */
function bottomOf(
  stacks: readonly Stack[],
  index: number,
  side: Stack["side"],
) {
  const later = stacks
    .slice(index + 1)
    .filter((each) => each.side === side)
    .slice(0, 2);
  const line = later[0] ? LINE_OFFSET[later[0].rowKind] : 0;
  const room = firstOf(
    later.flatMap(namesOf),
    "top",
    `calc(anchor(--dn-column bottom) + ${line.toString()}px)`,
  );
  return `calc(${room} - ${line.toString()}px)`;
}

/** Puts the viewport in reach of a layer that starts out inside its content. */
function ViewportProbe({ onFound }: { onFound: (el: HTMLElement) => void }) {
  return (
    <span
      hidden
      ref={(element) => {
        const viewport = element?.closest<HTMLElement>(
          "[data-slot='message-scroller-viewport']",
        );
        if (viewport) {
          onFound(viewport);
        }
      }}
    />
  );
}

interface OpenCard {
  note: DeveloperNote;
}

/**
 * What only a developer reads, in the transcript's margins and apart from it.
 * Each note places itself by the name of the row it belongs to, and this
 * stylesheet names those rows from outside, so no row knows it is here. A row
 * that isn't on the page leaves its note off the page.
 */
export default function DeveloperNotesLayer({
  chatId,
  sessionId,
  turns,
}: {
  chatId: ChatId;
  sessionId: StoreId.Session;
  turns: readonly Turn[];
}) {
  const mode = useAtomValue(chatNotesAtom);
  const source = use(DeveloperNotesSourceContext);
  const all = source.useNotes({ chatId, sessionId });
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  const [card, setCard] = useState<OpenCard>();
  const [isPinned, setIsPinned] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const moved = useRef({ at: 0, x: 0, y: 0, dx: 0, dy: 0 });

  useLayoutEffect(() => {
    if (card) {
      cardRef.current?.showPopover();
    }
  }, [card]);

  // Clicked into, a card stays until it is dismissed.
  useEffect(() => {
    if (!isPinned) {
      return;
    }
    const close = () => {
      setIsPinned(false);
      setCard(undefined);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    const onDown = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("[data-dn='card']")
      ) {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [isPinned]);

  const loaded = new Set(turns.map((turn) => turn.id));
  const stacks = stacksOf(all.filter((note) => loaded.has(note.turn)));

  if (mode === "off") {
    return null;
  }
  if (!viewport) {
    return <ViewportProbe onFound={setViewport} />;
  }

  const later = (fn: () => void, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, ms);
  };
  const noteOf = (id: string) => all.find((note) => note.id === id);
  /** More sideways than up or down, the way a card's side is from its note. */
  const isHeadingForCard = () =>
    performance.now() - moved.current.at < HEADING_FOR_CARD_MS &&
    Math.abs(moved.current.dx) > Math.abs(moved.current.dy) &&
    (card?.note.side === "right" ? moved.current.dx < 0 : moved.current.dx > 0);

  const onMove = (event: React.PointerEvent) => {
    const { at, x, y } = moved.current;
    const now = performance.now();
    moved.current = {
      at: now,
      dx: now - at < HEADING_FOR_CARD_MS ? event.clientX - x : 0,
      dy: now - at < HEADING_FOR_CARD_MS ? event.clientY - y : 0,
      x: event.clientX,
      y: event.clientY,
    };
  };
  const onOver = (event: React.PointerEvent) => {
    if (isPinned || event.buttons !== 0 || !(event.target instanceof Element)) {
      return;
    }
    const id =
      event.target.closest<HTMLElement>("[data-dn='line']")?.dataset.note;
    const note = id === undefined ? undefined : noteOf(id);
    if (note) {
      const open = () => {
        setCard({ note });
      };
      if (!card) {
        later(open, CARD_OPENS_AFTER_MS);
      } else if (isHeadingForCard()) {
        later(open, HEADING_FOR_CARD_MS);
      } else {
        window.clearTimeout(timer.current);
        open();
      }
    } else if (event.target.closest("[data-dn='card']")) {
      window.clearTimeout(timer.current);
    } else {
      later(() => {
        setCard(undefined);
      }, CARD_CLOSES_AFTER_MS);
    }
  };
  const onLeave = () => {
    if (!isPinned) {
      later(() => {
        setCard(undefined);
      }, CARD_CLOSES_AFTER_MS);
    }
  };

  return createPortal(
    <div
      aria-hidden
      data-developer-notes=""
      data-mode={mode}
      onPointerLeave={onLeave}
      onPointerMove={onMove}
      onPointerOver={onOver}
    >
      <style>{STYLES}</style>
      <style>{anchorRules(stacks)}</style>
      {stacks.map((stack, index) => (
        <div
          data-dn="stack"
          data-owner={stack.row}
          data-row-kind={stack.rowKind}
          data-side={stack.side}
          key={stack.key}
          style={{
            bottom: bottomOf(stacks, index, stack.side),
            top: `calc(${firstOf(namesOf(stack), "top", "-9999px")} + ${LINE_OFFSET[stack.rowKind].toString()}px)`,
          }}
        >
          {stack.notes.map((note) => (
            <span
              data-dn="line"
              data-note={note.id}
              key={note.id}
              style={
                card?.note.id === note.id
                  ? { anchorName: "--dn-card-line" }
                  : undefined
              }
            >
              <i data-dn="mark" />
              <span data-dn="word">{note.label}</span>
            </span>
          ))}
        </div>
      ))}
      {card && (
        <div
          data-dn="card"
          data-side={card.note.side}
          onPointerDown={() => {
            setIsPinned(true);
          }}
          popover="manual"
          ref={cardRef}
        >
          <strong data-dn="card-head">{card.note.label}</strong>
        </div>
      )}
    </div>,
    viewport,
  );
}
