import { type StepShows, writtenFileShows } from "./transcript-message";
import { type ActivityRow, type Turn, type TurnStep } from "./turns-of";

/** The kinds of card. */
export type WorkCardKind = "files" | "generated" | "images" | "page";

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
  file: "files",
  generated: "generated",
  image: "images",
  page: "page",
};

/**
 * The cards an activity's calls come to, in order. The rules for what a call
 * puts up:
 *
 * 1. A call with nothing to show changes nothing, and a call that failed, or
 *    one that has not started (waiting its turn behind a call before it in
 *    its message, or still being written while one before it runs), has
 *    nothing to show.
 * 2. Things of one kind share a card, so a browser's commands update one page.
 * 3. A file card is one file: each file a call names replaces the last. Of
 *    the files a shell call changed, only those a written file would show
 *    count (`writtenFileShows`), so code and data it saves put up nothing;
 *    of several, a lone page is what it made, and otherwise none is.
 * 4. A file written whole shows once there is something to see
 *    (`writeShows`), so a card that comes for it opens on the file as it
 *    looks rather than on its source going by.
 * 5. A browser command puts up a page card only where it changes what the
 *    page shows (`changesPage`); one that only reads the page joins a page
 *    card already up.
 */
export function cardsOf({ steps }: Pick<ActivityRow, "steps">): WorkCard[] {
  const cards: WorkCard[] = [];
  for (const [index, step] of steps.entries()) {
    if (
      step.status === "failed" ||
      !hasStarted(step, steps.slice(0, index)) ||
      !writeShows(step)
    ) {
      continue;
    }
    const changed = (step.facts?.files ?? []).flatMap((file) =>
      file.via === "disk" &&
      file.change !== "deleted" &&
      writtenFileShows(file.path) !== undefined
        ? [{ isNew: file.change === "created", path: file.path }]
        : [],
    );
    const pages = changed.filter(
      (file) => writtenFileShows(file.path) === "page",
    );
    const changedFile = step.shows
      ? undefined
      : changed.length === 1
        ? changed[0]
        : pages.length === 1
          ? pages[0]
          : undefined;
    const kind = step.shows
      ? KIND_OF[step.shows.kind]
      : changedFile !== undefined
        ? "files"
        : undefined;
    if (kind === undefined) {
      continue;
    }
    const last = cards.at(-1);
    if (
      step.shows?.kind === "page" &&
      !step.shows.changesPage &&
      last?.kind !== "page"
    ) {
      continue;
    }
    if (last?.kind === kind && kind !== "files") {
      last.steps.push(step);
    } else {
      cards.push({ changedFile, kind, steps: [step] });
    }
  }
  return cards;
}

/**
 * Whether a call has started, of the calls before it in its activity. A page
 * being written whole has from its first words: a card draws it as they
 * arrive, whatever waits ahead of it in its message, and keeps it up while it
 * waits its turn to be saved.
 */
function hasStarted(step: TurnStep, before: readonly TurnStep[]): boolean {
  if (step.shows?.kind === "file" && step.shows.source !== undefined) {
    return true;
  }
  if (step.status === "queued") {
    return false;
  }
  return (
    step.status !== "writing" ||
    !before.some(
      (other) =>
        other.metadata.messageId === step.metadata.messageId &&
        (other.status === "running" || other.status === "queued"),
    )
  );
}

/**
 * Whether a call writing a file whole has something to see yet: a page once
 * its source so far draws enough (`pageDrawsEnough`), a drawing or a table
 * once written, prose from its first words, and code or data never. Each only
 * ever turns true while its call goes on, so a card that opens for one stays.
 * Any other call has, as far as this goes.
 */
function writeShows({ shows, status, tool }: TurnStep): boolean {
  if (tool !== "tool-write_file" || shows?.kind !== "file") {
    return true;
  }
  switch (writtenFileShows(shows.path)) {
    case "page": {
      return (
        status === "done" ||
        (shows.source !== undefined && pageDrawsEnough(shows.source))
      );
    }
    case "picture": {
      return status === "done";
    }
    case "words": {
      return true;
    }
    case undefined: {
      return false;
    }
  }
}

/** The text a page arriving draws before it is worth a card, if it has no heading or picture yet. */
const PAGE_ENOUGH_TEXT = 200;

/**
 * What of a page's markup draws nothing: a comment, or an element whose
 * insides are never drawn as text, each to its end or, unfinished, to the end
 * of the source so far.
 */
const UNDRAWN =
  /<!--[\s\S]*?(?:-->|$)|<(script|style|template|title|noscript)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;

/** A tag, or one still being written at the end of the source so far. */
const TAG = /<[^>]*(?:>|$)/g;

/**
 * Whether a page's source so far draws enough to be worth a card: a heading
 * with words, a picture, or a few lines of text. Read from the source as it
 * arrives, so it only ever turns true as more comes.
 */
export function pageDrawsEnough(source: string): boolean {
  const drawn = source.replaceAll(UNDRAWN, "");
  if (/<(?:img|svg|canvas|video)\b[^>]*>/i.test(drawn)) {
    return true;
  }
  const heading = /<h1\b[^>]*>([\s\S]*?)(?:<\/h1\s*>|$)/i.exec(drawn)?.[1];
  if (heading !== undefined && /\S/.test(heading.replaceAll(TAG, ""))) {
    return true;
  }
  const text = drawn.replaceAll(TAG, " ").replaceAll(/\s+/g, " ").trim();
  return text.length >= PAGE_ENOUGH_TEXT;
}

/**
 * The card up now: the newest of the work in the turn. An activity with
 * nothing to show yet keeps the card of the one before it, so the card holds
 * through the gaps between activities rather than blinking, at the cost of
 * showing the earlier one's a little longer. Words after the work end it, in
 * a turn still working as in one that ended: the agent has moved on, and a card
 * is never drawn above what it says. A task's card takes over the same way at
 * any time, since the task is what is moving now and carries a card of its own.
 */
export function workCardOf(turn: Pick<Turn, "rows">): WorkCard | undefined {
  const found = walkBack(turn);
  return found === "ended" ? undefined : found;
}

/**
 * The turn whose card is up, of a session's turns: the same walk as `workCardOf`,
 * carried back across turns, so one card is up in the whole transcript. A
 * message sent mid-turn starts a turn of its own, and the card stays where it
 * was until that turn's work shows something, says something, asks the
 * person, or starts a task.
 */
export function workCardTurnOf(
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

/** The newest card of a turn's work, "ended" if a task, a card or step asking the person, or words came after it. */
function walkBack(turn: Pick<Turn, "rows">): WorkCard | "ended" | undefined {
  for (const row of turn.rows.toReversed()) {
    if (row.kind === "task" || row.kind === "ask" || row.kind === "text") {
      return "ended";
    }
    if (row.kind !== "activity") {
      continue;
    }
    const card = cardsOf(row).at(-1);
    const cardAt = row.steps.findLastIndex((step) =>
      card?.steps.includes(step),
    );
    if (row.steps.findLastIndex((step) => step.putsUpCard) > cardAt) {
      return "ended";
    }
    if (card) {
      return card;
    }
  }
  return undefined;
}
