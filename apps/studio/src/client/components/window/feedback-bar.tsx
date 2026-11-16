import {
  feedbackBarAtom,
  openReportDialog,
} from "@/client/atoms/report-dialog";
import { discardFeedback } from "@/client/lib/problem-reports";
import { MegaphoneSimpleIcon } from "@phosphor-icons/react/MegaphoneSimple";
import { XIcon } from "@phosphor-icons/react/X";
import { useAtomValue } from "jotai";
import { AnimatePresence, motion, useIsPresent } from "motion/react";

/** The bar's width, in layout px. */
const BAR_WIDTH = 300;

/**
 * The room between the bar and the window's right edge, in screen px rather
 * than layout px, so the bar clears the curve of the window's rounded
 * bottom-right corner and the edge the system draws along it, which do not
 * grow with the UI's zoom.
 */
const EDGE_GAP = 20;

/** How the bar comes and goes: quick, and easing to rest with no overshoot. */
const BAR_MOTION = {
  duration: 0.2,
  ease: [0.2, 0, 0, 1],
  type: "tween",
} as const;

/**
 * Feedback put down, while it waits: a dark bar at the right end of the
 * window's foot with the note's first line, or the write-up's title before
 * there is a note. A press brings the dialog back as it was left, and its
 * cross throws the draft away, with an Undo.
 */
export function FeedbackBar() {
  const draft = useAtomValue(feedbackBarAtom);
  return (
    <AnimatePresence initial={false}>
      {draft && (
        <FootBar
          key="bar:feedback"
          label={
            draft.note.trim().split("\n")[0] ||
            draft.writeups[0]?.title ||
            "Feedback"
          }
          onClose={() => {
            discardFeedback(draft);
          }}
          onOpen={() => {
            openReportDialog(draft.request);
          }}
        />
      )}
    </AnimatePresence>
  );
}

/**
 * The bar itself. Flush with the foot in the light theme, where it has no
 * ring to double the edge the system draws there; a screen pixel up in the
 * dark one, where it has.
 */
function FootBar({
  label,
  onClose,
  onOpen,
}: {
  label: string;
  onClose: () => void;
  onOpen: () => void;
}) {
  const isPresent = useIsPresent();
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="pointer-events-auto absolute bottom-0 z-40 flex h-9 items-center overflow-hidden rounded-t-lg bg-gray-900 text-[12px] font-medium text-white shadow-xl-soft [clip-path:inset(-4rem_-4rem_0_-4rem)] dark:bottom-[calc(1px/var(--app-zoom))] dark:bg-gray-800 dark:ring-1 dark:ring-[color-mix(in_srgb,#fff_10%,var(--background))]"
      data-slot="feedback-bar"
      exit={{ opacity: 0, y: 36 }}
      inert={!isPresent}
      initial={{ opacity: 0, y: 36 }}
      style={{
        right: `calc(${EDGE_GAP}px / var(--app-zoom))`,
        width: BAR_WIDTH,
      }}
      transition={BAR_MOTION}
    >
      <button
        className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left hover:bg-white/8"
        onClick={onOpen}
        type="button"
      >
        <MegaphoneSimpleIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
      <button
        aria-label="Discard feedback"
        className="grid h-full w-8 shrink-0 place-items-center text-white/80 hover:bg-white/8 hover:text-white"
        onClick={onClose}
        type="button"
      >
        <XIcon className="size-3.5" />
      </button>
    </motion.div>
  );
}
