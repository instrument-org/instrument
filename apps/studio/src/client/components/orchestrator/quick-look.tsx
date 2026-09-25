import { type FileTab, pageSlotsAtom } from "@/client/atoms/orchestrator";
import { FileViewer } from "@/client/components/file-viewer";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useWatchedFileUrl } from "@/client/hooks/use-watched-file-url";
import { fileUrlOf } from "@/client/lib/file-url";
import { getFileType } from "@/client/lib/get-file-type";
import { isTypingTarget } from "@/client/lib/is-typing-target";
import { useSetAtom } from "jotai";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { COMPOSE_GUEST_LAYER } from "./compose-layout";
import { useOrchestrator } from "./context";
import { useWindowTabs } from "./window-tabs";

/** The group a page looked at is kept under while the panel is up, off every strip. */
const QUICK_LOOK_GROUP = "page:quick-look";

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
  const page = useLookedAtPage(
    file && getFileType({ filename: file.name }) === "html"
      ? file.hostPath
      : undefined,
  );
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
          // Under the menus (`z-50`), with the page's guest a layer over the
          // panel, the way a draft window holds its page.
          // Faded rather than zoomed in: a page is drawn over the panel's
          // box where it is measured, and a box still growing would put the
          // page where the panel is not yet.
          className="z-40 h-full gap-0 p-0 outline-none [--guest-bottom-radius:var(--radius-3xl)] data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100"
          // Most of the window, the way Quick Look fills it, whatever the zoom.
          maxHeight="calc(85vh / var(--content-zoom))"
          // A document's shape rather than the window's: on a wide screen
          // the panel would otherwise stretch a page into a banner.
          maxWidth="min(calc(88vw / var(--content-zoom)), calc(85vh * 1.25 / var(--content-zoom)), 64rem)"
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
          overlayClassName="z-40"
          // The viewer's own head closes it, beside the file's actions.
          showCloseButton={false}
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
              // A page's file is looked at as the page itself, live, the way
              // the tab opening it shows it.
              {...(page ? { page } : {})}
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

/**
 * The page's file under the panel drawn live: a page tab in a group of its
 * own, drawn into the slot the viewer gives it on the layer over the panel,
 * and closed as the panel moves off it or goes.
 */
function useLookedAtPage(hostPath: string | undefined): ReactNode {
  const { browser } = useOrchestrator();
  const { allTabs, close } = useWindowTabs();
  const setPageSlots = useSetAtom(pageSlotsAtom);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const hasBrowser = browser !== null;
  const tabIds = allTabs
    .filter((tab) => tab.group === QUICK_LOOK_GROUP)
    .map((tab) => tab.id)
    .join("\n");
  // One tab at a time: the page walked to replaces the one before it.
  useEffect(() => {
    const kept =
      hostPath === undefined || !browser
        ? undefined
        : browser.openOrFocus(fileUrlOf(hostPath), { group: QUICK_LOOK_GROUP });
    for (const id of tabIds.split("\n").filter(Boolean)) {
      if (id !== kept) {
        close(id);
      }
    }
    // Once per page looked at; the list is read as it stands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostPath, hasBrowser]);
  useEffect(
    () => () => {
      for (const id of tabIds.split("\n").filter(Boolean)) {
        close(id);
      }
    },
    // On the way out alone, with the tabs as they stood.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    setPageSlots((current) => ({
      ...current,
      [QUICK_LOOK_GROUP]: {
        insideOverlay: true,
        into: slot,
        layer: COMPOSE_GUEST_LAYER,
      },
    }));
    return () => {
      setPageSlots((current) => {
        const { [QUICK_LOOK_GROUP]: _gone, ...rest } = current;
        return rest;
      });
    };
  }, [slot, setPageSlots]);
  return hostPath === undefined ? undefined : (
    <div className="h-full" ref={setSlot} />
  );
}
