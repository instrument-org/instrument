import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { AnimatePresence, motion } from "motion/react";
import { createContext, useContext, useEffect, useState } from "react";

/** How long a view says what it shows was just updated. */
const UPDATED_NOTE_MS = 3000;

/**
 * Whether a view of a file was updated a moment ago, and the way to say it
 * just was. Each update starts the moment over, so a file an agent is still
 * writing keeps saying so until it stops.
 */
export function useUpdatedNote() {
  const [updates, setUpdates] = useState<null | number>(null);
  useEffect(() => {
    if (updates === null) {
      return;
    }
    const timer = setTimeout(() => {
      setUpdates(null);
    }, UPDATED_NOTE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [updates]);
  return {
    mark: () => {
      setUpdates((count) => (count ?? 0) + 1);
    },
    shown: updates !== null,
    /** Which update the view is saying it had, so each one turns the arrow again. */
    turn: updates ?? 0,
  };
}

/**
 * Says the file a view shows was just updated, for a view that takes writes
 * in itself rather than being handed a new version: a live editor merging an
 * agent's edit. Absent outside a viewer that says it, where it does nothing.
 */
export const UpdatedNoteContext = createContext<(() => void) | null>(null);

/** Tells the viewer around this one that its file was just updated, when there is one. */
export function useMarkUpdated() {
  const mark = useContext(UpdatedNoteContext);
  return () => {
    mark?.();
  };
}

/**
 * "Updated", for a moment after the file a view shows was written and the
 * view took the new version in. The part that changed is often off screen, so
 * without it the view can look as though nothing happened.
 */
export function UpdatedNote({ shown, turn }: { shown: boolean; turn: number }) {
  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.span
          animate={{ opacity: 1, x: 0 }}
          className="flex h-5 shrink-0 items-center gap-1 rounded-full bg-brand-500/15 pr-1.5 pl-1 text-xs font-medium text-brand-text"
          exit={{ opacity: 0, x: 4 }}
          initial={{ opacity: 0, x: 6 }}
          // One key for the note's whole life, so a write landing while it
          // fades out brings this one back instead of leaving it to go.
          key="updated"
          role="status"
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          {/* One turn for each update: the view was loaded again. */}
          <motion.span
            animate={{ rotate: 360 }}
            className="flex"
            initial={{ rotate: 0 }}
            key={turn}
            transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <ArrowClockwiseIcon className="size-3" weight="bold" />
          </motion.span>
          Updated
        </motion.span>
      )}
    </AnimatePresence>
  );
}
