import { BLOCK_CLOSE, BLOCK_OPEN } from "@/client/lib/motion";
import { cn } from "@/client/lib/utils";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { createPortal } from "react-dom";

/**
 * What is attached, scrolling under the box's cap. The row leaves whole with
 * its last file, and the chips in it are not told they are going, so it takes
 * no press on its way out: a second one on a remove button would run the
 * removal again from the render before it left.
 */
function AttachmentsScroller({ children }: { children: React.ReactNode }) {
  const isPresent = useIsPresent();
  return (
    <div
      className="flex max-h-32 min-h-0 flex-wrap items-start gap-2 overflow-y-auto scroll-fade-y p-2"
      data-slot="composer-attachments"
      inert={!isPresent}
    >
      {children}
    </div>
  );
}

/**
 * The box the prompt is composed in: rows stacked around an editor that takes
 * whatever they leave.
 *
 * `maxHeight` is the only number in the layout, and the row template is what
 * answers to it, so a row can be added here without a second number kept in step
 * with the first. Budgeting the actions row as a constant is what once let a
 * long draft with a file attached paint over the buttons.
 *
 * A grid rather than a stack, because the rows are not equals: attached files
 * take the height they need, the editor takes what is left and scrolls past it,
 * and only when that leaves the editor under its floor do the files start to
 * give. Flex distributes a shortfall in proportion to what each row already
 * takes, which has no way to say which of them should give first.
 */
export function ComposerFrame({
  actions,
  actionsInto,
  attachments,
  children,
  maxHeight,
  notice,
  overlay,
  ref,
}: {
  /** The button row along the bottom. Never pushed out of the box. */
  actions: React.ReactNode;
  /**
   * An element of the host's the button row is drawn into instead, so a
   * head over the words can carry the controls; the box then ends at its
   * words. Nothing is drawn until the element exists.
   */
  actionsInto?: HTMLElement | null;
  /** Attached files, above the editor. Absent when nothing is attached. */
  attachments?: React.ReactNode;
  /** The editor. Fills the row it is given and scrolls past it. */
  children: React.ReactNode;
  /** Layout px: inside the zoom root, so the cap scales with the rest of the UI. Null for no cap but the host's layout. */
  maxHeight: null | number;
  /** One row about the chosen model, over everything else: a newer release on offer, or a problem to fix before sending. */
  notice?: React.ReactNode;
  /** Laid over the whole box, out of flow: the drop target, the re-entry ring. */
  overlay?: React.ReactNode;
  /** The box itself, for anything that has to be sized or placed against it. */
  ref?: React.Ref<HTMLDivElement>;
}) {
  // The row is drawn where the host asked for it, or along the box's foot; a
  // host that named an element the page has not made yet gets no row rather
  // than one along the foot in the meantime.
  const actionsRow =
    actionsInto === undefined ? (
      <div
        className="row-start-3 flex items-end justify-between gap-2 pt-2"
        data-slot="composer-actions"
      >
        {actions}
      </div>
    ) : actionsInto === null ? null : (
      createPortal(
        <div
          className="flex min-w-0 flex-1 items-center gap-2"
          data-slot="composer-actions"
        >
          {actions}
        </div>,
        actionsInto,
      )
    );
  return (
    <div
      className={cn(
        // isolate: the overlay covers the composer and nothing beyond it.
        // relative also lifts the box over the folder tray tucked under its top
        // edge.
        "relative isolate grid w-full grid-rows-[auto_minmax(3rem,1fr)_auto]",
        // The box gives way to the host's layout: squeezed, its editor row
        // scrolls, since the host sets the floor and the room around it.
        "min-h-0 px-3 pt-3 pb-2",
        // A card of its own, its corners matching the panes it sits beside,
        // and selectable in hosts that are not.
        "rounded-[18px] bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05),0_4px_12px_-4px_rgb(0_0_0/0.08)] ring-1 ring-black/6 select-text dark:ring-white/8",
        "[&_.prompt-editor]:min-h-12 [&_.prompt-editor]:text-[14px] [&_.prompt-editor]:leading-6",
      )}
      data-slot="composer-frame"
      ref={ref}
      style={maxHeight === null ? undefined : { maxHeight }}
    >
      {overlay}

      {/* Rows are placed rather than flowed: with nothing attached the first row
          is empty and sizes to nothing, and the editor still has to land in the
          row that can give.

          The row opens the box rather than appearing inside it, so what was
          attached is read as arriving. `initial={false}`: a draft restored with
          files already had them. */}
      {/* The notice and what is attached share the first row, stacked. The row
          clips, as the attachments did when they were the row themselves, so
          a long list of files gives way under the cap; the notice is one line
          and keeps its height. */}
      {/* The row's padding, given back by its margin, moves its clip out to
          where the attachments' own negative margin reaches, so the chips'
          rings and remove buttons are not cut along it. */}
      <div className="row-start-1 -mx-2 -mt-2 flex min-h-0 min-w-0 flex-col overflow-hidden px-2 pt-2">
        <AnimatePresence initial={false}>
          {notice && (
            <motion.div
              animate={{ height: "auto", opacity: 1 }}
              className="shrink-0 overflow-hidden"
              exit={{ height: 0, opacity: 0, transition: BLOCK_CLOSE }}
              initial={{ height: 0, opacity: 0 }}
              key="notice"
              transition={BLOCK_OPEN}
            >
              <div className="pb-2" data-slot="composer-notice">
                {notice}
              </div>
            </motion.div>
          )}
          {attachments && (
            // The negative margin carries the clip out past the chips, so the
            // remove buttons that sit outside them survive both it and the
            // scroller's own.
            <motion.div
              animate={{ height: "auto", opacity: 1 }}
              className="-mx-2 -mt-2 mb-2 min-h-0 overflow-hidden"
              exit={{ height: 0, opacity: 0, transition: BLOCK_CLOSE }}
              initial={{ height: 0, opacity: 0 }}
              key="attachments"
              transition={BLOCK_OPEN}
            >
              <AttachmentsScroller>{attachments}</AttachmentsScroller>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* `min-w-0`: a grid item is floored at the width of its own content,
          and a pasted link is one word as wide as a paragraph. Without this the
          row grows to fit it and the draft paints out past the box. */}
      <div className="row-start-2 flex min-h-0 min-w-0 flex-col">
        {children}
      </div>

      {actionsRow}
    </div>
  );
}
