export interface TimelineGroup {
  /** The group's heading as written, Markdown taken off; absent before the first one. */
  heading?: string;
  /** The group's lines, read as a timeline of their own. */
  lines: string;
}

// `# Day 1, Friday`, or a line that is bold and nothing else.
const HEADING = /^\s*(?:#{1,6}\s+(.+?)\s*#*|(\*\*|__)([^*_]+?)\2:?)\s*$/;

/**
 * A timeline's lines split at its group headings, so an itinerary reads as
 * days and then times. A timeline with no heading is one group.
 */
export function parseTimelineGroups(content: string): TimelineGroup[] {
  const groups: TimelineGroup[] = [{ lines: "" }];
  for (const line of content.split("\n")) {
    const match = HEADING.exec(line);
    const heading = (match?.[1] ?? match?.[3])?.trim().replace(/:$/, "");
    if (heading) {
      groups.push({ heading, lines: "" });
      continue;
    }
    const group = groups.at(-1);
    if (group) {
      group.lines += group.lines === "" ? line : `\n${line}`;
    }
  }
  return groups.filter(
    (group, index) => index > 0 || group.lines.trim() !== "",
  );
}
