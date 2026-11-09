import { chatNotesAtom } from "@/client/atoms/chat-notes";
import {
  type ChatId,
  type DeveloperNote,
  type StoreId,
  type Turn,
} from "@instrument-org/workspace/client";
import { useAtomValue } from "jotai";
import { use, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sort } from "radashi";

import { CopyButton } from "../copy-button";
import { NoteMark } from "./developer-note-marks";
import STYLES from "./developer-notes-layer.css?inline";
import { DeveloperNotesSourceContext } from "./developer-notes-source";

/** How long the pointer rests on a mark before its card opens. */
const CARD_OPENS_AFTER_MS = 150;
/** How long the pointer can be off both a note and its card before the card closes. */
const CARD_CLOSES_AFTER_MS = 150;
/** How long a move heading for the card ignores the notes it crosses. */
const HEADING_FOR_CARD_MS = 120;
/** The most lines a stack shows. Past that, the last place is a count. */
const MOST_LINES = 4;

/**
 * Where a note's 17px line starts below the top of what it sits by, so its mark
 * sits level with that row's first line. Measured per kind of row; a row whose
 * first line moves needs its number moved.
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
const workedRow = (turn: StoreId.Message) => `worked:${turn}`;

interface Stack {
  /** The turn whose closed Worked row this stands in for, with all its notes. */
  fold?: StoreId.Message;
  key: string;
  notes: DeveloperNote[];
  row: string;
  rowKind: DeveloperNote["rowKind"];
  side: DeveloperNote["side"];
}

/**
 * Notes beside one row on one side make one stack, in the order they happened.
 * A turn with notes in its fold gets one stack more, on the Worked row, that
 * shows only while that row is closed.
 */
function stacksOf(notes: readonly DeveloperNote[]): Stack[] {
  const stacks = new Map<string, Stack>();
  const put = (stack: Omit<Stack, "notes">, note: DeveloperNote) => {
    const known = stacks.get(stack.key);
    if (known) {
      known.notes.push(note);
    } else {
      stacks.set(stack.key, { ...stack, notes: [note] });
    }
  };
  for (const note of notes) {
    if (note.foldedIn !== undefined) {
      const row = workedRow(note.foldedIn);
      put(
        {
          fold: note.foldedIn,
          key: `fold:${row}`,
          row,
          rowKind: "activity",
          side: "left",
        },
        note,
      );
    }
    put(
      {
        key: `${note.side}:${note.row}`,
        row: note.row,
        rowKind: note.rowKind,
        side: note.side,
      },
      note,
    );
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

/**
 * Where a stack sits. One line needs no room worked out, which is most of them
 * and most of what laying the layer out costs. A closed fold's total stands by
 * its Worked row, and goes far above the page as soon as a row of its fold is on
 * it, whichever side of the Worked row that row is on, since below the page it
 * would grow the scroller: the distance to that row is zero with no such row, by
 * anchor()'s fallback.
 */
function stackStyle(stacks: readonly Stack[], index: number) {
  const stack = stacks[index];
  if (!stack) {
    return undefined;
  }
  const offset = `${LINE_OFFSET[stack.rowKind].toString()}px`;
  const top = firstOf(namesOf(stack), "top", "-9999px");
  if (stack.fold !== undefined) {
    const [first] = stack.notes;
    const worked = rowName(stack.row);
    const row = first ? rowName(first.row) : worked;
    return {
      top: `calc(${top} + ${offset} - abs(anchor(${row} top, anchor(${worked} top, 0px)) - anchor(${worked} top, 0px)) * 100000)`,
    };
  }
  return stack.notes.length === 1
    ? { top: `calc(${top} + ${offset})` }
    : {
        bottom: bottomOf(stacks, index, stack.side),
        top: `calc(${top} + ${offset})`,
      };
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

type OpenCard =
  | { key: string; kind: "list"; notes: DeveloperNote[]; side: Stack["side"] }
  | { key: string; kind: "note"; note: DeveloperNote; side: Stack["side"] };

const isError = (note: DeveloperNote) => note.kind === "error";

/**
 * One note's line. It shows only where the stack has room for it: `fits` is how
 * many lines the stack has to have room for, before this one shows.
 */
function NoteLine({
  fits,
  isCardHere,
  note,
}: {
  fits: number;
  isCardHere: boolean;
  note: DeveloperNote;
}) {
  return (
    <span
      data-dn="line"
      data-error={isError(note) ? "" : undefined}
      data-fits={fits}
      data-note={note.id}
      data-open={isCardHere ? "" : undefined}
      style={isCardHere ? { anchorName: "--dn-card-line" } : undefined}
    >
      <NoteMark note={note} />
    </span>
  );
}

/** What's past what a stack can show, for one height of it. */
function CountLine({
  at,
  count,
  cardKey,
  listKey,
}: {
  at: number;
  cardKey: string | undefined;
  count: number;
  listKey: string;
}) {
  const isCardHere = cardKey === `${listKey}@${at.toString()}`;
  return (
    <span
      data-count-at={at}
      data-dn="line"
      data-list={listKey}
      data-open={isCardHere ? "" : undefined}
      style={isCardHere ? { anchorName: "--dn-card-line" } : undefined}
    >
      <span data-dn="count">+{count}</span>
    </span>
  );
}

/**
 * A note's line and each count line a stack may need, by how much room it gets.
 * An error goes first and shows at any height, so no count can stand for it.
 */
function StackLines({
  cardKey,
  stack,
}: {
  cardKey: string | undefined;
  stack: Stack;
}) {
  const notes = sort(stack.notes, (note) => (isError(note) ? 0 : 1));
  const shown = notes.slice(
    0,
    notes.length > MOST_LINES ? MOST_LINES - 1 : MOST_LINES,
  );
  const lastFits = notes.length <= MOST_LINES;
  const opensOnError = notes[0] !== undefined && isError(notes[0]);
  return (
    <>
      {shown.map((note, index) => (
        <NoteLine
          fits={
            (index === 0 && opensOnError) ||
            (lastFits && index === notes.length - 1)
              ? index + 1
              : index + 2
          }
          isCardHere={cardKey === note.id}
          key={note.id}
          note={note}
        />
      ))}
      {Array.from(
        { length: Math.min(notes.length - 1, MOST_LINES) },
        (_, index) => index + 1,
      )
        .filter((at) => at > 1 || !opensOnError)
        .map((at) => (
          <CountLine
            at={at}
            cardKey={cardKey}
            count={notes.length - at + 1}
            key={at}
            listKey={stack.key}
          />
        ))}
    </>
  );
}

/**
 * A closed fold's one place: its only note's mark, or how many are in it with an
 * error's triangle beside the number. Hovering either lists them.
 */
function FoldLine({
  cardKey,
  stack,
}: {
  cardKey: string | undefined;
  stack: Stack;
}) {
  const isCardHere = cardKey === `${stack.key}@0`;
  const [only] = stack.notes;
  const error = stack.notes.find(isError);
  const anchor = {
    "data-open": isCardHere ? "" : undefined,
    style: isCardHere ? { anchorName: "--dn-card-line" } : undefined,
  };
  if (only && stack.notes.length === 1) {
    return (
      <span
        data-dn="line"
        data-error={isError(only) ? "" : undefined}
        data-fits="1"
        data-list={stack.key}
        {...anchor}
      >
        <NoteMark note={only} />
      </span>
    );
  }
  return (
    <>
      {error && (
        <span data-dn="line" data-error="" data-fits="1" data-list={stack.key}>
          <NoteMark note={error} />
        </span>
      )}
      <span data-dn="line" data-fits="1" data-list={stack.key} {...anchor}>
        <span data-dn="count">{stack.notes.length}</span>
      </span>
    </>
  );
}

/** A note's card: its name, and what the model read of it. */
function NoteCard({
  chatId,
  note,
  sessionId,
}: {
  chatId: ChatId;
  note: DeveloperNote;
  sessionId: StoreId.Session;
}) {
  const source = use(DeveloperNotesSourceContext);
  const body = source.useBody({ chatId, note: note.id, sessionId });
  const words = body?.text ?? body?.detail;
  return (
    <>
      <div data-dn="card-top">
        <strong data-dn="card-head">{note.label}</strong>
        {words !== undefined && (
          <CopyButton
            iconSize={12}
            label="Copy"
            onCopy={() => navigator.clipboard.writeText(words)}
          />
        )}
      </div>
      {body && !body.wasSent && (
        <p data-dn="card-unsent">This wasn&apos;t sent to the model.</p>
      )}
      {words !== undefined && <pre data-dn="card-words">{words}</pre>}
    </>
  );
}

/** Everything a stack holds, grouped by the row each note went out with. */
function NoteList({
  notes,
  onOpen,
}: {
  notes: readonly DeveloperNote[];
  onOpen: (note: DeveloperNote) => void;
}) {
  const groups = new Map<string, DeveloperNote[]>();
  for (const note of notes) {
    groups.set(note.row, [...(groups.get(note.row) ?? []), note]);
  }
  return (
    <>
      <strong data-dn="card-head">{notes.length} notes</strong>
      {[...groups.values()].map((group) => (
        <div key={group[0]?.row}>
          <div data-dn="list-group">{group[0]?.rowLabel}</div>
          {group.map((note) => (
            <button
              data-dn="list-note"
              key={note.id}
              onClick={() => {
                onOpen(note);
              }}
              type="button"
            >
              {note.label}
            </button>
          ))}
        </div>
      ))}
    </>
  );
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
  const isOn = useAtomValue(chatNotesAtom);
  const source = use(DeveloperNotesSourceContext);
  const all = source.useNotes({ chatId, sessionId });
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  const [card, setCard] = useState<OpenCard>();
  const [isPinned, setIsPinned] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const moved = useRef({ at: 0, dx: 0, dy: 0, x: 0, y: 0 });

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

  if (!isOn) {
    return null;
  }
  if (!viewport) {
    return <ViewportProbe onFound={setViewport} />;
  }

  const later = (fn: () => void, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, ms);
  };
  /** More sideways than up or down, the way a card's side is from its note. */
  const isHeadingForCard = (now: number) =>
    now - moved.current.at < HEADING_FOR_CARD_MS &&
    Math.abs(moved.current.dx) > Math.abs(moved.current.dy) &&
    (card?.side === "right" ? moved.current.dx < 0 : moved.current.dx > 0);

  const cardFor = (line: HTMLElement): OpenCard | undefined => {
    const stackElement = line.closest<HTMLElement>("[data-dn='stack']");
    const stack = stacks.find((each) => each.key === stackElement?.dataset.key);
    if (!stack) {
      return undefined;
    }
    const side = stack.side;
    const noteId = line.dataset.note;
    if (noteId !== undefined) {
      const note = stack.notes.find((each) => each.id === noteId);
      return note && { key: note.id, kind: "note", note, side };
    }
    const at = line.dataset.countAt ?? "0";
    const key = `${stack.key}@${at}`;
    const [only] = stack.notes;
    return only && stack.notes.length === 1
      ? { key, kind: "note", note: only, side }
      : { key, kind: "list", notes: stack.notes, side };
  };

  const onMove = (event: React.PointerEvent) => {
    const { at, x, y } = moved.current;
    const now = event.timeStamp;
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
    const line = event.target.closest<HTMLElement>("[data-dn='line']");
    const next = line ? cardFor(line) : undefined;
    if (next) {
      const open = () => {
        setCard(next);
      };
      if (!card) {
        later(open, CARD_OPENS_AFTER_MS);
      } else if (isHeadingForCard(event.timeStamp)) {
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
      onPointerLeave={onLeave}
      onPointerMove={onMove}
      onPointerOver={onOver}
    >
      <style>{STYLES}</style>
      <style>{anchorRules(stacks)}</style>
      {stacks.map((stack, index) => (
        <div
          data-dn="stack"
          data-fold={stack.fold}
          data-key={stack.key}
          data-many={
            stack.notes.length > 1 && stack.fold === undefined ? "" : undefined
          }
          data-owner={stack.row}
          data-row-kind={stack.rowKind}
          data-side={stack.side}
          key={stack.key}
          style={stackStyle(stacks, index)}
        >
          <div data-dn="lines">
            {stack.fold === undefined ? (
              <StackLines cardKey={card?.key} stack={stack} />
            ) : (
              <FoldLine cardKey={card?.key} stack={stack} />
            )}
          </div>
        </div>
      ))}
      {card && (
        <div
          data-dn="card"
          data-side={card.side}
          onPointerDown={() => {
            setIsPinned(true);
          }}
          // The scroller takes a wheel in React's tree, which this is inside,
          // as the reader scrolling the transcript.
          onWheel={(event) => {
            event.stopPropagation();
          }}
          popover="manual"
          ref={cardRef}
        >
          {card.kind === "list" ? (
            <NoteList
              notes={card.notes}
              onOpen={(note) => {
                setCard({ ...card, kind: "note", note });
              }}
            />
          ) : (
            <NoteCard
              chatId={chatId}
              key={card.note.id}
              note={card.note}
              sessionId={sessionId}
            />
          )}
        </div>
      )}
    </div>,
    viewport,
  );
}
