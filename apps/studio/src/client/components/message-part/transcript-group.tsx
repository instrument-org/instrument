import { createContext, type ReactNode, useContext } from "react";

import { cn } from "../../lib/utils";

interface TranscriptGroupValue {
  /** There is something behind the head line, so the chevron is worth drawing. */
  canExpand: boolean;
  isExpanded: boolean;
  /**
   * This row is the group's head line: the one thing on screen when the group
   * is folded. It answers a click by opening the group rather than itself, and
   * while the agent is working it is the row that carries the live indicator, so
   * there is one thing moving per group.
   */
  isHead: boolean;
  toggle: () => void;
}

const TranscriptGroupContext = createContext<null | TranscriptGroupValue>(null);

/**
 * What a run of step rows sits in.
 *
 * The transcript is on an 8px rhythm from top to bottom, and every container in
 * it spaces its children by `gap-2` to get there. A step row cannot: it carries
 * 4px of its own padding so there is something to click, which would put its
 * neighbors 16px away. So a run stacks its rows flush and pulls itself in by
 * that padding, which leaves the text of a step exactly 8px from whatever is
 * above and below it.
 *
 * Exported because a row can sit outside a group and still has to land on that
 * rhythm: the planning line does, and it is replaced by a real step.
 */
export const STEP_RUN = "-my-1 flex flex-col";

/**
 * The shape every row in a run takes, wherever it is drawn from.
 *
 * A tool call, a phase heading and a reasoning row are one line each and have to
 * be interchangeable: the fold swaps one for another in the same slot, and a
 * label that shifts by a pixel between them reads as the row moving rather than
 * the step changing. So the geometry is stated once here rather than three times
 * where the rows are built.
 *
 * Every piece of it is load-bearing:
 *
 * - `py-1` is the click target, and it is also half of the run's rhythm. Rows in
 *   a run stack flush, so a row's 4px against its neighbor's 4px is the 8px the
 *   rest of the transcript gets from a container's `gap`. `STEP_RUN` above
 *   cancels the outermost 4px of it, which is the only reason that box carries a
 *   negative margin -- the two constants are one decision and change together.
 * - `gap-2` is the space between the indicator and the label. `PlanningDotSlot`
 *   cancels this exact value when its dot leaves, so it is not free to change on
 *   its own.
 * - `rounded-lg` gives every interactive row the same focus-outline shape.
 * - No height and no leading override. The label's own 20px line box holds the
 *   row, and it is the same 20px a tool icon and the planning dot each take, so
 *   every row is 20px of content whatever is in it.
 * - `group/run-row` is the hover target the labels and chevrons read.
 */
export const TRANSCRIPT_ROW =
  "group/run-row flex min-w-0 items-center gap-2 rounded-lg py-1";

/**
 * The box around a run of steps and the head line over it.
 *
 * Which rows go in and which of them draw is decided in `buildTranscriptLayout`
 * and `planRow`; this is the box, the spacing, and the state of the toggle. The
 * spacing is `STEP_RUN`, which every run of steps takes whether or not it is a
 * group.
 */
export function TranscriptGroup({
  canExpand,
  children,
  className,
  isExpanded,
  onToggle,
}: {
  canExpand: boolean;
  children: ReactNode;
  /** Spacing the box takes from what sits above it; see `PROSE_GAP_IN_GROUP`. */
  className?: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <TranscriptGroupContext.Provider
      value={{ canExpand, isExpanded, isHead: false, toggle: onToggle }}
    >
      <div className={cn(STEP_RUN, className)}>{children}</div>
    </TranscriptGroupContext.Provider>
  );
}

/**
 * Marks its child as the group's head line; see `isHead`.
 *
 * A wrapper rather than a prop because the row it wraps is a copy of an ordinary
 * step, rendered by the same code that renders it where it really sits, and only
 * its position in the group tells the two apart.
 */
export function TranscriptGroupHead({ children }: { children: ReactNode }) {
  const group = useContext(TranscriptGroupContext);
  return (
    <TranscriptGroupContext.Provider
      value={group === null ? null : { ...group, isHead: true }}
    >
      {children}
    </TranscriptGroupContext.Provider>
  );
}

/**
 * Null outside a group, which is how a row knows it is on its own in the
 * transcript rather than one of a run something else is heading.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useTranscriptGroup(): null | TranscriptGroupValue {
  return useContext(TranscriptGroupContext);
}
