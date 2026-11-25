export interface TimelineEntry {
  /** The date or time, as written. Empty on an entry that opened with none. */
  when: string;
  /** Inline Markdown. */
  what: string;
}

// A bullet an agent adds when it reads the block as a list. A leading number
// stays, since a date can open with one.
const BULLET = /^[*+-]\s+/;

// The date ends at the first colon with a space after it, so the colon in
// `10:15 AM` is part of it. The date may be in bold, with the colon inside the
// bold or after it.
const ENTRY = /^(\*\*|__)?(.+?)(?:\1:|:\1)\s+(.+)$/u;

/**
 * Reads the body of a ```timeline fence: one `date: what happened` per line,
 * in the order written. A line that is not one carries on the entry above it,
 * so nothing the agent wrote is dropped.
 */
export function parseTimeline(content: string): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const raw of content.split("\n")) {
    const line = raw.trim().replace(BULLET, "");
    if (line === "") {
      continue;
    }
    const [, , when = "", what = line] = ENTRY.exec(line) ?? [];
    const last = entries.at(-1);
    if (when === "" && last) {
      last.what += `\n${line}`;
    } else {
      entries.push({ what, when: when.trim() });
    }
  }

  return entries;
}

/** Whether a line names its date, which one still being typed may not yet. */
export function isTimelineEntry(line: string): boolean {
  return ENTRY.test(line.trim().replace(BULLET, ""));
}
