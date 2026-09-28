import { type FileTab, pageSlotsAtom } from "@/client/atoms/orchestrator";
import { FileViewer } from "@/client/components/file-viewer";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useWatchedFileUrl } from "@/client/hooks/use-watched-file-url";
import { fileUrlOf } from "@/client/lib/file-url";
import { getFileType } from "@/client/lib/get-file-type";
import { isTypingTarget } from "@/client/lib/is-typing-target";
import { XIcon } from "@phosphor-icons/react/X";
import { atom, useAtom, useSetAtom } from "jotai";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { COMPOSE_GUEST_LAYER } from "./compose-layout";
import { useOrchestrator } from "./context";
import { useWindowTabs } from "./window-tabs";

/** The group a page looked at is kept under while the panel is up, off every strip. */
const QUICK_LOOK_GROUP = "page:quick-look";

/** What the large panel shows: a file, by where it is, or a page by its address. */
export type LookTarget =
  | { kind: "file"; tab: FileTab }
  | { kind: "page"; title?: string; url: string };

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

/**
 * What the window's own panel shows, asked for from anywhere: a tab's Expand
 * puts what it has up here, to be seen at the size Quick Look gives a file.
 */
export const lookAtAtom = atom<LookTarget | null>(null);

/** The window's panel, for what `lookAtAtom` asks it to show. Mounted once. */
export function WindowLook() {
  const [target, setTarget] = useAtom(lookAtAtom);
  return (
    <LookPanel
      onClose={() => {
        setTarget(null);
      }}
      target={target}
    />
  );
}

/**
 * The panel itself: a file in its viewer, or a page drawn live, over most of
 * the window the way the Finder's Quick Look fills it.
 */
function LookPanel({
  onClose,
  onClosed,
  onExpand,
  target,
}: {
  onClose: () => void;
  /** Once the panel has gone: where the keyboard goes back to. */
  onClosed?: () => void;
  /** Opens the file in a tab of its own, for a panel opened from a folder. */
  onExpand?: (tab: FileTab) => void;
  target: LookTarget | null;
}) {
  const file = target?.kind === "file" ? target.tab : null;
  // Watched while the panel is up, so a write shows in it.
  const fileUrl = useWatchedFileUrl(file?.hostPath);
  const pageUrl =
    target?.kind === "page"
      ? target.url
      : file && getFileType({ filename: file.name }) === "html"
        ? fileUrlOf(file.hostPath)
        : undefined;
  const page = useLookedAtPage(pageUrl);
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={target !== null}
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
          onClosed?.();
        }}
        // Focus stays on the panel itself rather than moving to the first
        // control in it, so Space puts the panel away instead of pressing
        // whatever button it landed on, the way a second Space does in the
        // Finder. Caught on the way down, before any control sees it.
        onKeyDownCapture={(event) => {
          if (event.key === " " && !isTypingTarget(event.target)) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
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
          {file?.name ??
            (target?.kind === "page"
              ? (target.title ?? target.url)
              : "Quick Look")}
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
            onClose={onClose}
            {...(onExpand
              ? {
                  onExpand: () => {
                    onExpand(file);
                  },
                }
              : {})}
            // A page's file is looked at as the page itself, live, the way
            // the tab opening it shows it.
            {...(page ? { page } : {})}
          />
        ) : target?.kind === "page" ? (
          <div className="flex h-full flex-col">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-[13px]">
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {target.title ?? target.url}
              </span>
              <Button
                aria-label="Close"
                onClick={onClose}
                size="icon-sm"
                variant="ghost"
              >
                <XIcon className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1">{page}</div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The page under the panel drawn live, a page's file or a site: a page tab
 * in a group of its own, drawn into the slot the viewer gives it on the layer over the panel,
 * and closed as the panel moves off it or goes.
 */
function useLookedAtPage(url: string | undefined): ReactNode {
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
      url === undefined || !browser
        ? undefined
        : browser.openOrFocus(url, { group: QUICK_LOOK_GROUP });
    for (const id of tabIds.split("\n").filter(Boolean)) {
      if (id !== kept) {
        close(id);
      }
    }
    // Once per page looked at; the list is read as it stands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, hasBrowser]);
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
  return url === undefined ? undefined : (
    <div className="h-full" ref={setSlot} />
  );
}
