import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { AnimatePresence, motion } from "motion/react";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { formatRelativeTime } from "@/client/lib/relative-time";
import { whenWindowSeen } from "@/client/lib/window-seen";
import { createContext, useContext, useEffect, useRef, useState } from "react";

/** How long a view says what it shows was just updated. */
const UPDATED_NOTE_MS = 3000;
/** How old a write said late has to be before the note says how long ago. */
const SAY_AGO_MS = 60_000;
/** How soon after a tab comes back a write counts as taken in on the way back. */
const RETURN_MS = 2000;

/**
 * Whether a view of a file was updated a moment ago, and the way to say it
 * just was. Each update starts the moment over, so a file an agent is still
 * writing keeps saying so until it stops. Updates while the person is
 * elsewhere (another tab up, the window not seen) are said once, when they
 * come back, with how long ago the last one was.
 */
export function useUpdatedNote() {
  const isActiveTab = useIsActiveTab();
  const tabLeftAt = useRef<null | number>(null);
  const tabBackAt = useRef<null | number>(null);
  useEffect(() => {
    if (isActiveTab) {
      tabBackAt.current = Date.now();
    } else {
      tabLeftAt.current = Date.now();
    }
  }, [isActiveTab]);
  // The latest write not yet said: when the file says it was written, and
  // when the view found out.
  const [unsaid, setUnsaid] = useState<null | { at: number; markedAt: number }>(
    null,
  );
  const [note, setNote] = useState<null | {
    ago: null | string;
    turn: number;
  }>(null);
  useEffect(() => {
    if (unsaid === null || !isActiveTab) {
      return;
    }
    return whenWindowSeen(() => {
      const now = Date.now();
      const left = tabLeftAt.current;
      const back = tabBackAt.current;
      // A tab behind another takes nothing in, so a write it found on the
      // way back happened while it was away: the file's own time says when,
      // kept within that time away, since a copied or unpacked file can carry
      // a time from long before. Otherwise the view found out as it happened.
      const onReturn =
        left !== null &&
        back !== null &&
        back > left &&
        unsaid.markedAt >= back &&
        unsaid.markedAt - back < RETURN_MS;
      const written = onReturn
        ? Math.min(Math.max(unsaid.at, left), unsaid.markedAt)
        : unsaid.markedAt;
      setUnsaid(null);
      setNote((last) => ({
        ago:
          now - written >= SAY_AGO_MS
            ? formatRelativeTime(new Date(written), now)
            : null,
        turn: (last?.turn ?? 0) + 1,
      }));
    });
  }, [isActiveTab, unsaid]);
  useEffect(() => {
    if (note === null) {
      return;
    }
    const timer = setTimeout(() => {
      setNote(null);
    }, UPDATED_NOTE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [note]);
  return {
    /** How long ago the update said late was, past a minute. */
    ago: note?.ago ?? null,
    /** Takes when the file says it was written, which defaults to now. */
    mark: (at?: number) => {
      const now = Date.now();
      setUnsaid({ at: at ?? now, markedAt: now });
    },
    shown: note !== null,
    /** Which update the view is saying it had, so each one turns the arrow again. */
    turn: note?.turn ?? 0,
  };
}

/**
 * Says the file a view shows was just updated, for a view that takes writes
 * in itself rather than being handed a new version: a live editor merging an
 * agent's edit. Absent outside a viewer that says it, where it does nothing.
 */
export const UpdatedNoteContext = createContext<((at?: number) => void) | null>(
  null,
);

/** Tells the viewer around this one that its file was just updated, when there is one. */
export function useMarkUpdated() {
  const mark = useContext(UpdatedNoteContext);
  return (at?: number) => {
    mark?.(at);
  };
}

/**
 * "Updated", for a moment after the file a view shows was written and the
 * view took the new version in. The part that changed is often off screen, so
 * without it the view can look as though nothing happened.
 */
export function UpdatedNote({
  ago,
  shown,
  turn,
}: {
  ago: null | string;
  shown: boolean;
  turn: number;
}) {
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
          {ago === null ? "Updated" : `Updated ${ago}`}
        </motion.span>
      )}
    </AnimatePresence>
  );
}
