import { type FileTab } from "@/client/atoms/window";
import { type ReactNode, useRef, useState } from "react";

import { lookPathOf, type LookTarget } from "./look-at";
import { LookPanel } from "./look-panel";

/**
 * Space on a selected file or folder, showing it over the whole window the way the
 * Finder's Quick Look does.
 *
 * A hook rather than a component because the browser it belongs to has to be
 * told that the panel is up: while it is, the arrows walk the folder and the
 * panel follows the selection instead of the folder taking the keyboard back.
 * Every place that draws a folder browser wants all of this, and a place that
 * wired only some of it is a place where Space does nothing.
 */
export function useQuickLook({
  openFile,
}: {
  openFile: (tab: FileTab) => void;
}): {
  /** Rendered anywhere inside the screen; it draws over the window. */
  dialog: ReactNode;
  /** Spread onto the folder browser. */
  props: {
    /** `from` finds the item's place on screen, for the panel to grow out of. */
    onQuickLook: (target: LookTarget, from?: () => Element | null) => void;
    onQuickLookFollow: (
      target: LookTarget,
      from?: () => Element | null,
    ) => void;
    quickLookOpen: boolean;
  };
} {
  const [target, setTarget] = useState<LookTarget | null>(null);
  // Where the keyboard was when the panel opened, so closing it puts the
  // keyboard back on the row rather than at the top of the screen.
  const origin = useRef<HTMLElement | null>(null);
  const place = useRef<(() => Element | null) | undefined>(undefined);

  return {
    dialog: (
      <LookPanel
        from={() => place.current?.() ?? null}
        onClose={() => {
          setTarget(null);
        }}
        onClosed={() => {
          origin.current?.focus();
        }}
        onExpand={(tab) => {
          setTarget(null);
          openFile(tab);
        }}
        target={target}
      />
    ),
    props: {
      onQuickLook: (next, from) => {
        place.current = from;
        if (document.activeElement instanceof HTMLElement) {
          origin.current = document.activeElement;
        }
        // The same item again puts the panel away, the way Space does twice.
        setTarget((current) =>
          current && lookPathOf(current) === lookPathOf(next) ? null : next,
        );
      },
      onQuickLookFollow: (next, from) => {
        place.current = from;
        setTarget(next);
      },
      quickLookOpen: target !== null,
    },
  };
}
