import { isTurnFolded, type Turn, type TurnRow } from "./turns-of";
import { slotOf, slotTurnOf, type SlotKind } from "./slot";

/**
 * What a transcript draws at one moment, flattened to the elements a person
 * sees move: each turn's opener, rows, Worked row, card, Thinking line and
 * footer, and under a task's row the task's own card. Keys follow the React
 * keys the transcript draws with, so a key that goes and another that comes
 * is a remount, whatever the two look like.
 */
interface DrawnElement {
  /** What it is, as a person would name it. A card's kind is its content's. */
  kind: string;
  key: string;
  /** How much of it there is: an activity's steps, a text's characters. */
  size: number;
  turn: string;
}

export interface DrawnFrame {
  at: number;
  elements: DrawnElement[];
}

/** What the transcript knows of a task while drawing its row, from the task's own records. */
export interface TaskView {
  card?: SlotKind;
  isWorking: boolean;
}

/**
 * The elements `Transcript` and `TurnView` draw for `turns` at `now`, in
 * order. It mirrors their rules (fold, card placement, Thinking line,
 * footer) closely enough to see identity and order, not pixels.
 */
export function drawnFrame(
  turns: readonly Turn[],
  now: number,
  taskOf: (sessionId: string) => TaskView | undefined = () => undefined,
): DrawnFrame {
  const cardTurn = slotTurnOf(turns);
  const elements: DrawnElement[] = [];
  for (const turn of turns) {
    const push = (key: string, kind: string, size = 1) => {
      elements.push({ key: `${turn.id}/${key}`, kind, size, turn: turn.id });
    };
    if (turn.opener) {
      push("opener", turn.opener.fromChat ? "assignment" : "message");
    }
    const isFolded = isTurnFolded(turn, now);
    const card =
      isFolded || turn.id !== cardTurn ? undefined : slotOf(turn)?.kind;
    const cardAt =
      turn.phase === "working"
        ? turn.rows.length - 1
        : turn.rows.findLastIndex((row) => row.kind === "activity");
    turn.rows.forEach((row, index) => {
      if (isFolded && row.id === turn.foldLineAt) {
        push("worked", "worked");
      }
      if (isFolded && turn.foldedRowIds.has(row.id)) {
        return;
      }
      push(row.id, kindOf(row, turn), sizeOf(row));
      if (row.kind === "task" && row.sessionId) {
        const task = taskOf(row.sessionId);
        if (task?.isWorking && task.card) {
          push(`${row.id}/slot-card`, `task-card:${task.card}`);
        }
      }
      if (index === cardAt && card) {
        push("slot-card", `card:${card}`);
      }
    });
    if (turn.live?.kind === "thinking") {
      push("thinking", "thinking");
    }
    const hasReply =
      turn.rows.findLast((row) => row.kind !== "note")?.kind === "text";
    if (turn.phase !== "working" && hasReply && turn.replies.length > 0) {
      push("footer", "footer");
    }
  }
  return { at: now, elements };
}

function kindOf(row: TurnRow, turn: Turn): string {
  switch (row.kind) {
    case "activity": {
      return turn.live?.kind === "activity" && turn.live.activityId === row.id
        ? "activity:live"
        : "activity";
    }
    case "ask": {
      return row.isOpen ? "ask:open" : "ask";
    }
    case "error": {
      return `error:${row.draws}`;
    }
    default: {
      return row.kind;
    }
  }
}

function sizeOf(row: TurnRow): number {
  switch (row.kind) {
    case "activity": {
      return row.steps.length;
    }
    case "text": {
      return row.part.text.length;
    }
    default: {
      return 1;
    }
  }
}

/**
 * A change between two frames that is not an element growing in place or a
 * new one at the end of what is drawn: the moves a person reads as a jump.
 *
 * - `swap`: in one frame an element went and another came at its place, a
 *   remount where one thing turned into another.
 * - `vanish`: an element went, not into a fold, and nothing took its place.
 * - `fold`: elements went into a Worked row, the one removal that is meant.
 * - `unfold`: a Worked row went and its rows came back without a click.
 * - `insert`: an element came above one already drawn, pushing it down.
 * - `reorder`: two elements drawn in both frames changed places.
 * - `morph`: an element kept its key and changed kind, which draws in place.
 * - `shrink`: an element kept its key and got smaller.
 * - `blink`: an element came back within `BLINK_MS` of going.
 * - `flash`: an element was up for less than `FLASH_MS`.
 */
type FlickerKind =
  | "blink"
  | "flash"
  | "fold"
  | "insert"
  | "morph"
  | "reorder"
  | "shrink"
  | "swap"
  | "unfold"
  | "vanish";

export interface FlickerEvent {
  at: number;
  /** What it was and what it became, as `from` → `to` kinds where both exist. */
  detail: string;
  kind: FlickerKind;
  /** The element's key, or both keys of a swap. */
  keys: string[];
  /** Whether it happened above the last turn, where it moves what the reader has scrolled to. */
  aboveLastTurn: boolean;
}

/** An element coming back sooner than this after going reads as a blink. */
const BLINK_MS = 1000;
/** An element up for less than this reads as a flash. */
const FLASH_MS = 300;

/**
 * Follows a session's frames and reports every jump between them, with the
 * births and lifetimes it needs to tell a blink or a flash.
 */
export class FlickerTracker {
  #previous: DrawnFrame | undefined;
  #born = new Map<string, { at: number; kind: string }>();
  #gone = new Map<string, { at: number; kind: string }>();
  readonly events: FlickerEvent[] = [];
  /** Elements that ever came up, by kind, so a count of jumps has its denominator. */
  readonly births = new Map<string, number>();

  add(frame: DrawnFrame): void {
    const previous = this.#previous;
    this.#previous = frame;
    const lastTurn = frame.elements.at(-1)?.turn;
    const report = (
      kind: FlickerKind,
      keys: string[],
      detail: string,
      turn: string,
    ) => {
      this.events.push({
        aboveLastTurn: turn !== lastTurn,
        at: frame.at,
        detail,
        keys,
        kind,
      });
    };
    const before = new Map(
      (previous?.elements ?? []).map((element, index) => [
        element.key,
        { element, index },
      ]),
    );
    const after = new Map(
      frame.elements.map((element, index) => [element.key, { element, index }]),
    );

    for (const element of frame.elements) {
      if (before.has(element.key)) {
        continue;
      }
      this.#born.set(element.key, { at: frame.at, kind: element.kind });
      this.births.set(
        family(element.kind),
        (this.births.get(family(element.kind)) ?? 0) + 1,
      );
      const gone = this.#gone.get(element.key);
      if (gone && frame.at - gone.at < BLINK_MS) {
        report(
          "blink",
          [element.key],
          `${gone.kind} → ${element.kind}`,
          element.turn,
        );
      }
    }

    if (!previous) {
      return;
    }

    const removed = previous.elements.filter(
      (element) => !after.has(element.key),
    );
    const added = frame.elements.filter((element) => !before.has(element.key));
    const swappedIn = new Set<string>();

    for (const element of removed) {
      const born = this.#born.get(element.key);
      if (born && frame.at - born.at < FLASH_MS) {
        report(
          "flash",
          [element.key],
          `${element.kind} up ${frame.at - born.at}ms`,
          element.turn,
        );
      }
      this.#gone.set(element.key, { at: frame.at, kind: element.kind });
      const index = before.get(element.key)?.index ?? 0;
      const foldedNow = frame.elements.some(
        (each) => each.turn === element.turn && each.kind === "worked",
      );
      if (foldedNow) {
        report("fold", [element.key], element.kind, element.turn);
        continue;
      }
      // What came in where it was: the first new element of its turn after
      // the survivors that came before it.
      const neighbor = previous.elements
        .slice(0, index)
        .findLast((each) => after.has(each.key));
      const from = neighbor ? (after.get(neighbor.key)?.index ?? -1) + 1 : 0;
      const replacement = frame.elements
        .slice(from)
        .find(
          (each) =>
            each.turn === element.turn &&
            !before.has(each.key) &&
            !swappedIn.has(each.key),
        );
      if (
        replacement &&
        frame.elements
          .slice(from, frame.elements.indexOf(replacement))
          .every((each) => !before.has(each.key))
      ) {
        swappedIn.add(replacement.key);
        report(
          "swap",
          [element.key, replacement.key],
          `${element.kind} → ${replacement.kind}`,
          element.turn,
        );
      } else {
        report("vanish", [element.key], element.kind, element.turn);
      }
    }

    for (const element of added) {
      if (swappedIn.has(element.key)) {
        continue;
      }
      if (element.kind === "worked") {
        continue;
      }
      const index = after.get(element.key)?.index ?? 0;
      // What it pushes down: content already drawn, or anything of a later
      // turn. A card, a Thinking line or a footer at its own turn's end moves
      // under new work by design.
      const pushesDown = frame.elements
        .slice(index + 1)
        .some(
          (each) =>
            before.has(each.key) &&
            (each.turn !== element.turn || !TRAILING.test(each.kind)),
        );
      if (pushesDown) {
        const wasFolded = previous.elements.some(
          (each) => each.turn === element.turn && each.kind === "worked",
        );
        report(
          wasFolded &&
            !frame.elements.some(
              (each) => each.turn === element.turn && each.kind === "worked",
            )
            ? "unfold"
            : "insert",
          [element.key],
          element.kind,
          element.turn,
        );
      }
    }

    let lastIndex = -1;
    for (const element of frame.elements) {
      const was = before.get(element.key);
      if (!was) {
        continue;
      }
      if (was.index < lastIndex) {
        report("reorder", [element.key], element.kind, element.turn);
      }
      lastIndex = Math.max(lastIndex, was.index);
      // A live or open mark changes in place, which is the point of it.
      if (family(was.element.kind) !== family(element.kind)) {
        report(
          "morph",
          [element.key],
          `${was.element.kind} → ${element.kind}`,
          element.turn,
        );
      }
      if (element.size < was.element.size) {
        report(
          "shrink",
          [element.key],
          `${element.kind} ${was.element.size} → ${element.size}`,
          element.turn,
        );
      }
    }
  }
}

const TRAILING = /^(card:|task-card:|thinking$|footer$)/;

/** A kind without what only changes in place: `activity:live` is an activity. */
function family(kind: string): string {
  return kind.replace(/:live$|:open$/, "");
}
