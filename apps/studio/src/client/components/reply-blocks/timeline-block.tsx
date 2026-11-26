import { stripMarkdown } from "@instrument-org/shared/strip-markdown";
import {
  isTimelineEntry,
  parseTimeline,
} from "@instrument-org/workspace/client";
import remend from "remend";

import { parseTimelineGroups } from "./parse-timeline-groups";
import { useReplyMarkdown } from "./reply-markdown-context";

/**
 * Renders a ```timeline fence: the dates in a column, what happened beside
 * each, as part of the text around it. A heading line (`# Day 1, Friday`)
 * starts a group, drawn as a row across the grid, so an itinerary reads as
 * days and then times. While it is arriving, the line being typed waits for
 * its date to end, since until then it would read as more of the entry above.
 */
export function TimelineBlock({
  content,
  isArriving,
}: {
  content: string;
  isArriving: boolean;
}) {
  const markdown = useReplyMarkdown();
  const lineStart = content.lastIndexOf("\n") + 1;
  const settled =
    isArriving && !isTimelineEntry(content.slice(lineStart))
      ? content.slice(0, lineStart)
      : content;
  const groups = parseTimelineGroups(settled)
    .map((group) => ({ ...group, entries: parseTimeline(group.lines) }))
    .filter((group) => group.entries.length > 0 || group.heading);
  const lastGroup = groups.length - 1;

  if (groups.length === 0) {
    return null;
  }

  return (
    <div
      className="my-[1.25em] grid grid-cols-[fit-content(min(9em,28%))_auto_minmax(0,1fr)] gap-x-[0.875em]"
      data-slot="timeline"
      role="list"
    >
      {groups.map(({ entries, heading }, groupIndex) => (
        <div
          className="group/timeline-group col-span-full grid grid-cols-subgrid"
          key={groupIndex}
          role="none"
        >
          {heading && (
            <div
              className="col-span-full mb-[0.5em] font-medium group-not-first/timeline-group:mt-[1.25em]"
              role="heading"
              aria-level={4}
            >
              {stripMarkdown(heading)}
            </div>
          )}
          {entries.map(({ what, when }, index) => (
            <div
              className="group/entry col-span-full grid grid-cols-subgrid items-baseline"
              key={index}
              role="listitem"
            >
              <span className="text-right text-[0.875em] text-muted-foreground tabular-nums">
                {stripMarkdown(when)}
              </span>
              <span
                aria-hidden
                className="relative flex w-[0.4em] justify-center self-stretch"
              >
                <span className="absolute top-[calc(0.5lh-0.2em)] size-[0.4em] rounded-full bg-foreground/50" />
                <span className="absolute top-[calc(0.5lh+0.4em)] bottom-[calc(0.4em-0.5lh)] w-px bg-border group-last/entry:hidden" />
              </span>
              <div className="min-w-0 pb-[0.75em] group-last/entry:pb-0 [&>*]:my-0">
                {markdown.block(
                  isArriving &&
                    groupIndex === lastGroup &&
                    index === entries.length - 1
                    ? remend(what)
                    : what,
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
