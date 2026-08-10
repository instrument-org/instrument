import { createContext, type ReactNode, useContext } from "react";

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
 */
const STEP_RUN = "-my-1 flex flex-col";

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
  isExpanded,
  onToggle,
}: {
  canExpand: boolean;
  children: ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <TranscriptGroupContext.Provider
      value={{ canExpand, isExpanded, isHead: false, toggle: onToggle }}
    >
      <div className={STEP_RUN}>{children}</div>
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
