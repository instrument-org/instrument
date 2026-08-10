import { COMPOSER_CLOSE, COMPOSER_OPEN } from "@/client/lib/composer-motion";
import { cn } from "@/client/lib/utils";
import { AnimatePresence, motion } from "motion/react";

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
  attachments,
  children,
  maxHeight,
  overlay,
  ref,
}: {
  /** The button row along the bottom. Never pushed out of the box. */
  actions: React.ReactNode;
  /** Attached files, above the editor. Absent when nothing is attached. */
  attachments?: React.ReactNode;
  /** The editor. Fills the row it is given and scrolls past it. */
  children: React.ReactNode;
  /** Layout px: inside the zoom root, so the cap scales with the rest of the UI. */
  maxHeight: number;
  /** Covers the whole box, out of flow. The drag-and-drop target. */
  overlay?: React.ReactNode;
  /** The box itself, for anything that has to be sized or placed against it. */
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      className={cn(
        // isolate: the overlay covers the composer and nothing beyond it.
        // relative also lifts the box over the folder tray tucked under its top
        // edge.
        "relative isolate grid min-h-16 w-full grid-rows-[auto_minmax(3rem,1fr)_auto] rounded-[20px] p-4",
        "bg-white shadow-xs transition-shadow dark:bg-gray-800",
        "focus-within:ring-1 focus-within:ring-black/5 dark:focus-within:ring-white/5",
      )}
      data-slot="composer-frame"
      ref={ref}
      style={{ maxHeight }}
    >
      {overlay}

      {/* Rows are placed rather than flowed: with nothing attached the first row
          is empty and sizes to nothing, and the editor still has to land in the
          row that can give.

          The row opens the box rather than appearing inside it, so what was
          attached is read as arriving. `initial={false}`: a draft restored with
          files already had them. */}
      <AnimatePresence initial={false}>
        {attachments && (
          // The negative margin carries the clip out past the chips, so the
          // remove buttons that sit outside them survive both it and the
          // scroller's own.
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className="row-start-1 -mx-2 -mt-2 mb-2 overflow-hidden"
            exit={{ height: 0, opacity: 0, transition: COMPOSER_CLOSE }}
            initial={{ height: 0, opacity: 0 }}
            transition={COMPOSER_OPEN}
          >
            <div
              className="flex max-h-32 min-h-0 flex-wrap items-start gap-2 overflow-y-auto scroll-fade-y p-2"
              data-slot="composer-attachments"
            >
              {attachments}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="row-start-2 flex min-h-0 flex-col">{children}</div>

      <div
        className="row-start-3 flex items-end justify-between gap-2 pt-2"
        data-slot="composer-actions"
      >
        {actions}
      </div>
    </div>
  );
}
