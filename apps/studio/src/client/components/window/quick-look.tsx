import { type FileTab } from "@/client/atoms/window";
import { type ReactNode, useRef, useState } from "react";

import { LookPanel } from "./look-panel";

/**
 * Space on a selected file, showing it over the whole window the way the
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
    onQuickLook: (tab: FileTab) => void;
    onQuickLookFollow: (tab: FileTab) => void;
    quickLookOpen: boolean;
  };
} {
  const [file, setFile] = useState<FileTab | null>(null);
  // Where the keyboard was when the panel opened, so closing it puts the
  // keyboard back on the row rather than at the top of the screen.
  const origin = useRef<HTMLElement | null>(null);

  return {
    dialog: (
      <LookPanel
        onClose={() => {
          setFile(null);
        }}
        onClosed={() => {
          origin.current?.focus();
        }}
        onExpand={(tab) => {
          setFile(null);
          openFile(tab);
        }}
        target={file ? { kind: "file", tab: file } : null}
      />
    ),
    props: {
      onQuickLook: (tab) => {
        if (document.activeElement instanceof HTMLElement) {
          origin.current = document.activeElement;
        }
        // The same file again puts the panel away, the way Space does twice.
        setFile((current) => (current?.hostPath === tab.hostPath ? null : tab));
      },
      onQuickLookFollow: setFile,
      quickLookOpen: file !== null,
    },
  };
}
