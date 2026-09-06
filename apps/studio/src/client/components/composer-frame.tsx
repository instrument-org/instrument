import { BLOCK_CLOSE, BLOCK_OPEN } from "@/client/lib/motion";
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
  extras,
  layout = "block",
  leading,
  maxHeight,
  onBlur,
  onFocus,
  overlay,
  ref,
  trailing,
}: {
  /** The button row along the bottom. Never pushed out of the box. */
  actions: React.ReactNode;
  /** Attached files, above the editor. Absent when nothing is attached. */
  attachments?: React.ReactNode;
  /** The editor. Fills the row it is given and scrolls past it. */
  children: React.ReactNode;
  /**
   * A pill's second row, above the editor, present only while the pill is
   * open: the model and what the message will carry. It slides in and out.
   */
  extras?: React.ReactNode;
  /**
   * A block is the box with the editor above its button row. A pill is one
   * row, the height of a text field, with `leading` at its left and
   * `trailing` at its right and the editor between; it grows with the draft
   * up to `maxHeight`.
   */
  layout?: "block" | "pill";
  /** The pill's left end: the add menu. */
  leading?: React.ReactNode;
  /** Layout px: inside the zoom root, so the cap scales with the rest of the UI. */
  maxHeight: number;
  /** Focus entering and leaving the pill, for what it shows only while open. */
  onBlur?: React.FocusEventHandler<HTMLDivElement>;
  onFocus?: React.FocusEventHandler<HTMLDivElement>;
  /** Laid over the whole box, out of flow: the drop target, the re-entry ring. */
  overlay?: React.ReactNode;
  /** The box itself, for anything that has to be sized or placed against it. */
  ref?: React.Ref<HTMLDivElement>;
  /** The pill's right end: the send button. */
  trailing?: React.ReactNode;
}) {
  if (layout === "pill") {
    return (
      <div
        className={cn(
          "relative isolate flex w-full flex-col rounded-[22px] px-1.5 py-1.5",
          "bg-white shadow-sm-soft transition-shadow dark:bg-gray-800",
          "focus-within:ring-1 focus-within:ring-black/5 dark:focus-within:ring-white/5",
        )}
        data-slot="composer-frame"
        onBlur={onBlur}
        onFocus={onFocus}
        ref={ref}
        style={{ maxHeight }}
      >
        {overlay}
        <AnimatePresence initial={false}>
          {extras ? (
            <motion.div
              animate={{ height: "auto", opacity: 1 }}
              className="overflow-hidden"
              exit={{ height: 0, opacity: 0 }}
              initial={{ height: 0, opacity: 0 }}
              key="extras"
              transition={BLOCK_OPEN}
            >
              <div
                // `empty:hidden`: a row with nothing in it, a screen with no
                // chip to show, takes no height rather than a blank line.
                className="flex min-h-7 items-center gap-1 px-1 pb-1 empty:hidden"
                data-slot="composer-extras"
              >
                {extras}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
        {attachments ? (
          <div
            className="flex max-h-24 min-h-0 flex-wrap items-start gap-1.5 overflow-y-auto px-1 pt-1 pb-1.5"
            data-slot="composer-attachments"
          >
            {attachments}
          </div>
        ) : null}
        <div className="flex min-h-7 w-full items-end gap-1.5">
          <div className="flex shrink-0 items-center self-end">{leading}</div>
          {/* `min-w-0`: a pasted link is one word as wide as a paragraph. */}
          {/* One 20px line box for the words and the placeholder alike, centered
              in the row's 28px: the editor's own paragraph height is for the
              block, and would sit this line high by a couple of pixels. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col self-center py-1 [--prompt-editor-line:1.25rem] [&_.prompt-editor]:min-h-5 [&_.prompt-editor]:text-[13px] [&_.prompt-editor]:leading-5">
            {children}
          </div>
          <div
            className="flex shrink-0 items-center gap-1 self-end"
            data-slot="composer-actions"
          >
            {trailing}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        // isolate: the overlay covers the composer and nothing beyond it.
        // relative also lifts the box over the folder tray tucked under its top
        // edge.
        "relative isolate grid min-h-16 w-full grid-rows-[auto_minmax(3rem,1fr)_auto] rounded-[20px] p-4",
        "bg-white shadow-sm-soft transition-shadow dark:bg-gray-800",
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
            exit={{ height: 0, opacity: 0, transition: BLOCK_CLOSE }}
            initial={{ height: 0, opacity: 0 }}
            transition={BLOCK_OPEN}
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

      {/* `min-w-0`: a grid item is floored at the width of its own content,
          and a pasted link is one word as wide as a paragraph. Without this the
          row grows to fit it and the draft paints out past the box. */}
      <div className="row-start-2 flex min-h-0 min-w-0 flex-col">
        {children}
      </div>

      <div
        className="row-start-3 flex items-end justify-between gap-2 pt-2"
        data-slot="composer-actions"
      >
        {actions}
      </div>
    </div>
  );
}
