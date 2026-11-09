import { type StepShows } from "./transcript-message";
import { type ActivityRow, type Turn, type TurnStep } from "./turns-of";

/** The kinds of card. */
export type WorkCardKind = "files" | "generated" | "images" | "page" | "web";

/**
 * What the work card shows: a run of steps of one kind, which update one card in
 * place, however many there are.
 */
export interface WorkCard {
  /** The one file a shell call changed, which the disk told rather than the call. */
  changedFile: { isNew: boolean; path: string } | undefined;
  kind: WorkCardKind;
  steps: TurnStep[];
}

const KIND_OF: Record<StepShows["kind"], WorkCardKind> = {
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
export function cardsOf({ steps }: Pick<ActivityRow, "steps">): WorkCard[] {
  const cards: WorkCard[] = [];
  for (const step of steps) {
    if (step.status === "failed") {
      continue;
    }
    const changed = (step.facts?.files ?? []).flatMap((file) =>
      file.via === "disk" && file.change !== "deleted"
        ? [{ isNew: file.change === "created", path: file.path }]
        : [],
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
 * The card up now: the newest of the work in the turn. An activity with
 * nothing to show yet keeps the card of the one before it, so the card holds
 * through the gaps between activities rather than blinking, at the cost of
 * showing the earlier one's a little longer. It holds through what the agent
 * says too: a line before each command is how agents narrate, and a card that
 * went at each one would close and open again at every step. Once the turn
 * has ended, a turn that folds keeps its card until it does, so the card
 * closes with the work it shows; one that does not fold ends its card at the
 * words after the work. A task's card takes over the same way at any time,
 * since the task is what is moving now and carries a card of its own.
 */
export function workCardOf(
  turn: Pick<Turn, "foldedRowIds" | "phase" | "rows">,
): WorkCard | undefined {
  const found = walkBack(turn);
  return found === "ended" ? undefined : found;
}

/**
 * The turn whose card is up, of a session's turns: the same walk as `workCardOf`,
 * carried back across turns, so one card is up in the whole transcript. A
 * message sent mid-turn starts a turn of its own, and the card stays where it
 * was until that turn's work shows something, ends with words, or starts a
 * task.
 */
export function workCardTurnOf(
  turns: readonly Pick<Turn, "foldedRowIds" | "id" | "phase" | "rows">[],
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

/** The newest card of a turn's work, "ended" if a task, or words once a turn that does not fold ended, came after it. */
function walkBack(
  turn: Pick<Turn, "foldedRowIds" | "phase" | "rows">,
): WorkCard | "ended" | undefined {
  const wordsEnd = turn.phase !== "working" && turn.foldedRowIds.size === 0;
  for (const row of turn.rows.toReversed()) {
    if (row.kind === "task" || (row.kind === "text" && wordsEnd)) {
      return "ended";
    }
    const card = row.kind === "activity" ? cardsOf(row).at(-1) : undefined;
    if (card) {
      return card;
    }
  }
  return undefined;
}
