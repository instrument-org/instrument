import { inboxWidthAtom } from "@/client/atoms/window";
import { RAIL_FADE_TRANSITION } from "@/client/lib/rail-motion";
import { useAtomValue } from "jotai";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode } from "react";

import { type useInboxPeek } from "./use-inbox-peek";

/**
 * The inbox drawn over the row's left edge, at the width the inbox column
 * has, sliding out from the rail.
 */
export function InboxPeek({
  children,
  isOpen,
  onPointerEnter,
  onPointerLeave,
  panelRef,
}: Pick<
  ReturnType<typeof useInboxPeek>,
  "isOpen" | "onPointerEnter" | "onPointerLeave" | "panelRef"
> & {
  children: ReactNode;
}) {
  const width = useAtomValue(inboxWidthAtom);
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          animate={{ opacity: 1, x: 0 }}
          aria-label="Inbox"
          className="absolute inset-y-0 left-0 z-30 flex max-w-[calc(100%-3rem)] flex-col border-r border-border bg-background shadow-xl select-text [&_.prose]:text-[13px] [&_.prose]:leading-5 [&_.text-sm]:text-[13px]"
          exit={{ opacity: 0, x: -24 }}
          initial={{ opacity: 0, x: -24 }}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
          ref={panelRef}
          role="dialog"
          style={{ width }}
          transition={RAIL_FADE_TRANSITION}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
