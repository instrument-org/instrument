import { type FileTab } from "@/client/atoms/orchestrator";
import { FileViewer } from "@/client/components/file-viewer";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useWatchedFileUrl } from "@/client/hooks/use-watched-file-url";
import { getFileType } from "@/client/lib/get-file-type";
import { isTypingTarget } from "@/client/lib/is-typing-target";
import { type ReactNode, useRef, useState } from "react";

import { PageLook } from "./page-look";

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
  // Watched while the panel is up, so a write shows in it.
  const fileUrl = useWatchedFileUrl(file?.hostPath);
  // Where the keyboard was when the panel opened, so closing it puts the
  // keyboard back on the row rather than at the top of the screen.
  const origin = useRef<HTMLElement | null>(null);

  return {
    dialog: (
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setFile(null);
          }
        }}
        open={file !== null}
      >
        <DialogContent
          className="h-full gap-0 p-0 outline-none"
          // Most of the window, the way Quick Look fills it, whatever the zoom.
          maxHeight="calc(85vh / var(--content-zoom))"
          maxWidth="calc(88vw / var(--content-zoom))"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            origin.current?.focus();
          }}
          // Focus stays on the panel itself rather than moving to the first
          // control in it, so Space puts the panel away instead of pressing
          // whatever button it landed on, the way a second Space does in the
          // Finder. Caught on the way down, before any control sees it.
          onKeyDownCapture={(event) => {
            if (event.key === " " && !isTypingTarget(event.target)) {
              event.preventDefault();
              event.stopPropagation();
              setFile(null);
            }
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (event.currentTarget instanceof HTMLElement) {
              event.currentTarget.focus();
            }
          }}
        >
          <DialogTitle className="sr-only">
            {file?.name ?? "Quick Look"}
          </DialogTitle>
          {file && fileUrl !== undefined ? (
            <FileViewer
              className="h-full"
              file={{
                filename: file.name,
                hostPath: file.hostPath,
                url: fileUrl,
              }}
              key={file.hostPath}
              onClose={() => {
                setFile(null);
              }}
              onExpand={() => {
                setFile(null);
                openFile(file);
              }}
              // A page's file is looked at as the page, the way the system's
              // Quick Look shows one; opening it is the tab, which is live.
              {...(getFileType({ filename: file.name }) === "html"
                ? { page: <PageLook hostPath={file.hostPath} /> }
                : {})}
            />
          ) : null}
        </DialogContent>
      </Dialog>
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
