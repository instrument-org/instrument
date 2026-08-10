import { cn } from "../../lib/utils";
import { PlanningDotSlot } from "../planning-dot-slot";
import { RunRowChevron } from "../run-row-chevron";
import { TRANSCRIPT_ROW, useTranscriptGroup } from "./transcript-group";

/**
 * The one line a group of steps costs when it is folded.
 *
 * The same row whether the agent named the phase or the title was generated
 * from what the run contained, because to a reader those are the same thing:
 * a line saying what happened, with the steps behind it. It weighs the same as
 * any step row and settles to the same color, so what marks it as a heading is
 * what it lacks -- no icon, and therefore the left edge the rows beneath it are
 * measured from. Its padding is a step row's, so a run turning into a group
 * changes what the transcript says and not how tall it is.
 *
 * `isRunning` means the agent is still working inside this group, which only
 * the last one in a transcript can be. It is then the only row of the group
 * showing it: the row in flight beneath stays quiet, so there is one thing
 * moving per group.
 */
export function GroupHeading({
  isRunning = false,
  title,
}: {
  isRunning?: boolean;
  title: string;
}) {
  const group = useTranscriptGroup();

  // A heading rendered outside a group, or over one with nothing left to reveal,
  // has nothing to disclose and stays a plain row.
  const canExpand = group?.canExpand ?? false;
  const isExpanded = group?.isExpanded ?? false;

  return (
    <button
      className={cn(TRANSCRIPT_ROW, "cursor-default text-left")}
      disabled={!canExpand}
      onClick={group?.toggle}
      type="button"
    >
      <PlanningDotSlot isRunning={isRunning} />
      <span
        className={cn(
          "min-w-0 truncate text-sm",
          isRunning
            ? "brand-shiny-text"
            : cn(
                "text-muted-foreground",
                // A phase that turned out to hold nothing has nothing to
                // disclose, and lighting up under the pointer offers a click
                // that does not do anything.
                canExpand && "group-hover/run-row:text-foreground",
              ),
        )}
      >
        {title}
      </span>
      {canExpand && <RunRowChevron isOpen={isExpanded} />}
    </button>
  );
}
