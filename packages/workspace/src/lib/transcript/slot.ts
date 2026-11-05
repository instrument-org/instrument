import { type StepShows } from "./transcript-message";
import { type ActivityRow, type Turn, type TurnStep } from "./turns-of";

/** The kinds of card, one card per run of a kind. */
export type SlotKind = "files" | "generated" | "images" | "page" | "web";

/**
 * What the slot shows: a run of steps of one kind, which update one card in
 * place, however many there are.
 */
export interface SlotCard {
  /** The activity its newest step belongs to, to tell whether work has moved on. */
  activityId: ActivityRow["id"];
  /** The files a shell call changed, which the disk told rather than the call. */
  changedFiles: string[];
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
 * The cards a turn's work comes to, in order. The rules for what the slot
 * shows, and all of them:
 *
 * 1. A card stays until a different kind of card replaces it or the agent
 *    speaks (`slotOf`). A call with nothing to show changes nothing, and a call
 *    that failed has nothing to show.
 * 2. Things of one kind share a card, so a burst of files is one card and
 *    a browser's commands update one page.
 */
export function cardsOf(turn: Pick<Turn, "rows">): SlotCard[] {
  const cards: SlotCard[] = [];
  for (const row of turn.rows) {
    if (row.kind !== "activity") {
      continue;
    }
    for (const step of row.steps) {
      if (step.status === "failed") {
        continue;
      }
      const changedFiles = (step.facts?.files ?? []).flatMap((file) =>
        file.via === "disk" && file.change !== "deleted" ? [file.path] : [],
      );
      const kind = step.shows
        ? KIND_OF[step.shows.kind]
        : changedFiles.length > 0
          ? "files"
          : undefined;
      if (kind === undefined) {
        continue;
      }
      const last = cards.at(-1);
      if (last?.kind === kind) {
        last.steps.push(step);
        last.activityId = row.id;
        last.changedFiles.push(...changedFiles);
      } else {
        cards.push({ activityId: row.id, changedFiles, kind, steps: [step] });
      }
    }
  }
  return cards;
}

/**
 * The card up now: the turn's newest since the agent last spoke. Words go under
 * the work they follow and never move, and a card under those words would take
 * them from below it to above it at the next step, so the card goes as they
 * start. A task's card takes over from the work before it the same way, since
 * the task is what is moving now and carries a card of its own.
 */
export function slotOf(turn: Pick<Turn, "rows">): SlotCard | undefined {
  const lastSaid = turn.rows.findLastIndex(
    (row) => row.kind === "task" || row.kind === "text",
  );
  return cardsOf({ rows: turn.rows.slice(lastSaid + 1) }).at(-1);
}

/** Whether the work has moved past what the card shows. */
export function isSlotBehind(
  card: SlotCard,
  turn: Pick<Turn, "live">,
): boolean {
  return (
    turn.live?.kind !== "activity" || turn.live.activityId !== card.activityId
  );
}
