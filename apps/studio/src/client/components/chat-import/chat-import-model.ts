import { type RPCOutput } from "@/client/rpc/client";

export type Candidate =
  RPCOutput["workspace"]["chatImport"]["list"]["candidates"][number];

/** One line of the picker: a month's heading, or a chat under it. */
export type PickerRow =
  | { key: string; label: string; selectable: string[]; type: "month" }
  | { candidate: Candidate; key: string; type: "chat" };

/** Whether a chat can be picked: one already imported cannot. */
export function isSelectable(candidate: Candidate) {
  return candidate.imported === null;
}

/**
 * What a picker starts with picked: every chat the person had that is not
 * here yet. Bulk is the common case, so clearing to pick a few is one press
 * and picking hundreds is none.
 */
export function defaultPicks(candidates: readonly Candidate[]): Set<string> {
  return new Set(
    candidates
      .filter((candidate) => isSelectable(candidate) && !candidate.incidental)
      .map((candidate) => candidate.sourceId),
  );
}

/** The chats a search and the incidental toggle leave in view, newest first. */
export function visibleCandidates(
  candidates: readonly Candidate[],
  { query, showIncidental }: { query: string; showIncidental: boolean },
): Candidate[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return candidates
    .filter((candidate) => showIncidental || !candidate.incidental)
    .filter((candidate) => {
      if (words.length === 0) {
        return true;
      }
      const haystack = [candidate.title, candidate.preview, candidate.project]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .toSorted((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

/** A month's heading: its name this year, with the year before that. */
export function monthLabel(date: Date, now: Date) {
  return date.getFullYear() === now.getFullYear()
    ? MONTH.format(date)
    : MONTH_YEAR.format(date);
}

/**
 * The picker's rows: chats newest first under the month they were last
 * written in, each month carrying the chats its heading's box picks.
 */
export function pickerRows(
  candidates: readonly Candidate[],
  now: Date,
): PickerRow[] {
  const rows: PickerRow[] = [];
  let month: Extract<PickerRow, { type: "month" }> | undefined;
  for (const candidate of candidates) {
    const date = candidate.updatedAt;
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (month?.key !== key) {
      month = {
        key,
        label: monthLabel(date, now),
        selectable: [],
        type: "month",
      };
      rows.push(month);
    }
    if (isSelectable(candidate)) {
      month.selectable.push(candidate.sourceId);
    }
    rows.push({ candidate, key: candidate.sourceId, type: "chat" });
  }
  return rows;
}

/**
 * Picks every id in `ids`, or drops them all when every one is already
 * picked: what a box over a group of rows does.
 */
export function toggleAll(
  picked: ReadonlySet<string>,
  ids: readonly string[],
): Set<string> {
  const next = new Set(picked);
  if (ids.length > 0 && ids.every((id) => picked.has(id))) {
    for (const id of ids) {
      next.delete(id);
    }
  } else {
    for (const id of ids) {
      next.add(id);
    }
  }
  return next;
}

/**
 * A shift-click: every selectable chat between the last one pressed and this
 * one, as they stand in view, set to what this one becomes.
 */
export function pickRange(
  picked: ReadonlySet<string>,
  visible: readonly Candidate[],
  { from, to }: { from: string; to: string },
): Set<string> {
  const start = visible.findIndex((candidate) => candidate.sourceId === from);
  const end = visible.findIndex((candidate) => candidate.sourceId === to);
  const next = new Set(picked);
  if (start === -1 || end === -1) {
    return next;
  }
  const isPicking = !picked.has(to);
  for (const candidate of visible.slice(
    Math.min(start, end),
    Math.max(start, end) + 1,
  )) {
    if (!isSelectable(candidate)) {
      continue;
    }
    if (isPicking) {
      next.add(candidate.sourceId);
    } else {
      next.delete(candidate.sourceId);
    }
  }
  return next;
}

const SHORT_DATE = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
});
const SHORT_DATE_YEAR = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** A row's date: the day this year, with the year before that. */
export function shortDate(date: Date, now: Date) {
  return date.getFullYear() === now.getFullYear()
    ? SHORT_DATE.format(date)
    : SHORT_DATE_YEAR.format(date);
}

/** A count with its noun, singular for one: `1 chat`, `1,204 chats`. */
export function countOf(n: number, noun: string) {
  return `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : "s"}`;
}
