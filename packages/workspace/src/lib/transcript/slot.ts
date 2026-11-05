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
 * The card up now: the newest of the activity going on. A card belongs to its
 * activity and goes when the activity does, so a page the work has left never
 * follows it down the chat. It goes as the agent speaks too, since words go
 * under the work they follow and never move, and a task's card takes over the
 * same way, since the task is what is moving now and carries a card of its own.
 */
export function slotOf(turn: Pick<Turn, "rows">): SlotCard | undefined {
  const newest = turn.rows.findLast(
    (row) =>
      row.kind === "activity" || row.kind === "task" || row.kind === "text",
  );
  return newest?.kind === "activity" ? cardsOf(newest).at(-1) : undefined;
}
