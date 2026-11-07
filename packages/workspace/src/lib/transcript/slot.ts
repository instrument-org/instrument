import { type StepShows } from "./transcript-message";
import { type ActivityRow, type Turn, type TurnStep } from "./turns-of";

/** The kinds of card. */
export type SlotKind = "files" | "generated" | "images" | "page" | "web";

/**
 * What the slot shows: a run of steps of one kind, which update one card in
 * place, however many there are.
 */
export interface SlotCard {
  /** The one file a shell call changed, which the disk told rather than the call. */
  changedFile: string | undefined;
  kind: SlotKind;
  steps: TurnStep[];
}

const KIND_OF: Record<StepShows["kind"], SlotKind> = {
  fetch: "web",
  file: "files",
  generated: "generated",
  image: "images",
  opened: "page",
  page: "page",
  search: "web",
};

/**
 * The cards an activity's calls come to, in order. The rules for what a call
 * puts up:
 *
 * 1. A call with nothing to show changes nothing, and a call that failed has
 *    nothing to show.
 * 2. Things of one kind share a card, so a browser's commands update one page.
 * 3. A file card is one file: each file a call names replaces the last, and a
 *    shell call that changed several shows none, since no one of them is what
 *    it made.
 */
export function cardsOf({ steps }: Pick<ActivityRow, "steps">): SlotCard[] {
  const cards: SlotCard[] = [];
  for (const step of steps) {
    if (step.status === "failed") {
      continue;
    }
    const changed = (step.facts?.files ?? []).flatMap((file) =>
      file.via === "disk" && file.change !== "deleted" ? [file.path] : [],
    );
    const changedFile =
      !step.shows && changed.length === 1 ? changed[0] : undefined;
    const kind = step.shows
      ? KIND_OF[step.shows.kind]
      : changedFile !== undefined
        ? "files"
        : undefined;
    if (kind === undefined) {
      continue;
    }
    const last = cards.at(-1);
    if (last?.kind === kind && kind !== "files") {
      last.steps.push(step);
    } else {
      cards.push({ changedFile, kind, steps: [step] });
    }
  }
  return cards;
}

/**
 * The card up now: the newest of the work since the agent last spoke. An activity
 * with nothing to show yet keeps the card of the one before it, so the card holds
 * through the gaps between activities rather than blinking, at the cost of
 * showing the earlier one's a little longer. It goes as the agent speaks, since
 * words go under the work they follow and never move, and a task's card takes
 * over the same way, since the task is what is moving now and carries a card of
 * its own.
 */
export function slotOf(turn: Pick<Turn, "rows">): SlotCard | undefined {
  const found = walkBack(turn);
  return found === "ended" ? undefined : found;
}

/**
 * The turn whose card is up, of a session's turns: the same walk as `slotOf`,
 * carried back across turns, so one card is up in the whole transcript. A
 * message sent mid-turn starts a turn of its own, and the card stays where it
 * was until that turn's work shows something, speaks, or starts a task.
 */
export function slotTurnOf(
  turns: readonly Pick<Turn, "id" | "rows">[],
): Turn["id"] | undefined {
  for (const turn of turns.toReversed()) {
    const found = walkBack(turn);
    if (found === "ended") {
      return undefined;
    }
    if (found) {
      return turn.id;
    }
  }
  return undefined;
}

/** The newest card of a turn's work, "ended" if words or a task came after it. */
function walkBack(turn: Pick<Turn, "rows">): SlotCard | "ended" | undefined {
  for (const row of turn.rows.toReversed()) {
    if (row.kind === "task" || row.kind === "text") {
      return "ended";
    }
    const card = row.kind === "activity" ? cardsOf(row).at(-1) : undefined;
    if (card) {
      return card;
    }
  }
  return undefined;
}
