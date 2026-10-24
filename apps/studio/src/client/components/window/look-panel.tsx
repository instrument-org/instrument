import { type FileTab } from "@/client/atoms/window";
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
import { dialogMaxSize } from "@/client/hooks/use-app-zoom";
import { useAtom } from "jotai";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { lookAtAtom, type LookTarget } from "./look-at";
import { useHostedPage } from "./hosted-page";

/** The group a page looked at is kept under while the panel is up, off every strip. */
const QUICK_LOOK_GROUP = "page:quick-look";

/**
 * The window layer a looked-at page's guest is shown on: over the panel
 * (`z-45`), which is itself over the floating chats and drafts (`z-40`), and
 * under every menu and popover (`z-50`).
 */
const LOOK_GUEST_LAYER = 46;

/**
 * The panel itself: a file in its viewer (a page's file drawn live as the
 * page), over most of the window the way the Finder's Quick Look fills it.
 */
export function LookPanel({
  from,
  onClose,
  onClosed,
  onExpand,
  target,
}: {
  /**
   * The file's place on screen, a row or tile in a folder, which the panel
   * grows out of and goes back into. Asked again on the way out, since the
   * selection can have moved while the panel was up.
   */
  from?: () => Element | null;
  onClose: () => void;
  /** Once the panel has gone: where the keyboard goes back to. */
  onClosed?: () => void;
  /** Opens the file in a tab of its own, for a panel opened from a folder. */
  onExpand?: (tab: FileTab) => void;
  target: LookTarget | null;
}) {
  const open = target !== null;
  // The file stays in the panel while it goes, so it shrinks away with the
  // file in it rather than empty. A page's file does not: its page is drawn
  // over the panel rather than in it, and goes the moment the panel does.
  const [last, setLast] = useState(target);
  if (target !== null && target !== last) {
    setLast(target);
  }
  const lastFile = last?.tab ?? null;
  const file =
    target?.tab ?? (lastFile && !isPageFile(lastFile.name) ? lastFile : null);
  // Watched while the panel is up, so a write shows in it.
  const fileUrl = useWatchedFileUrl(file?.hostPath);
  const pageUrl =
    file && open && isPageFile(file.name)
      ? fileUrlOf(file.hostPath)
      : undefined;
  const page = useLookedAtPage(pageUrl);

  const [video, setVideo] = useState<VideoShape | null>(null);
  const videoShape = video && video.hostPath === file?.hostPath ? video : null;
  // Read from the element's own callbacks, which are made once per panel.
  const latest = useRef({ file, from, pageUrl });
  useLayoutEffect(() => {
    latest.current = { file, from, pageUrl };
  });
  const content = useRef<HTMLDivElement | null>(null);
  const setContent = (node: HTMLDivElement | null) => {
    content.current = node;
    if (!node) {
      return;
    }
    if (latest.current.pageUrl === undefined) {
      flyFrom(node, latest.current.from?.(), "enter");
    }
    // Media events do not bubble, so the panel catches them on the way down.
    node.addEventListener(
      "loadedmetadata",
      (event) => {
        const element = event.target;
        const hostPath = latest.current.file?.hostPath;
        if (
          !(element instanceof HTMLVideoElement) ||
          !hostPath ||
          element.videoWidth === 0 ||
          element.videoHeight === 0
        ) {
          return;
        }
        setVideo({
          aspect: element.videoWidth / element.videoHeight,
          // The head and edges around the video, which the panel adds to the
          // video's own height.
          chrome: node.offsetHeight - element.offsetHeight,
          hostPath,
          width: element.videoWidth,
        });
      },
      true,
    );
  };
  useLayoutEffect(() => {
    const node = content.current;
    if (!open && node && latest.current.file) {
      flyFrom(node, latest.current.from?.(), "exit");
    }
  }, [open]);

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent
        // Over the floating chats and drafts (`z-40`), which otherwise win
        // the tie from later in the window, and under the menus (`z-50`),
        // with the page's guest a layer over the panel.
        // Grown out of the file's place by `flyFrom`, and only faded with
        // none to grow from or for a page: a page is drawn over the panel's
        // box where it is measured, and a box still growing would put the
        // page where the panel is not yet.
        className="z-45 h-full gap-0 p-0 ease-[cubic-bezier(0.2,0.8,0.2,1)] outline-none [--guest-bottom-radius:var(--radius-3xl)] data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100"
        // Most of the window, the way Quick Look fills it, whatever the zoom.
        maxHeight={LOOK_HEIGHT}
        // A document's shape rather than the window's: on a wide screen
        // the panel would otherwise stretch a page into a banner. A video
        // takes its own shape, the way the Finder's Quick Look sizes one.
        maxWidth={
          videoShape
            ? videoWidth(videoShape)
            : "min(calc(88vw / var(--content-zoom)), calc(85vh * 1.25 / var(--content-zoom)), 64rem)"
        }
        ref={setContent}
        {...(videoShape ? { style: { height: videoHeight(videoShape) } } : {})}
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
        overlayClassName="z-45"
        // The viewer's own head closes it, beside the file's actions.
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{file?.name ?? "Preview"}</DialogTitle>
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
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

const LOOK_HEIGHT = "calc(85vh / var(--content-zoom))";

/** Narrower than this, the head's name and actions would not fit. */
const LOOK_MIN_WIDTH = "28rem";

function isPageFile(name: string) {
  return getFileType({ filename: name }) === "html";
}

/** A video's own shape, once it has loaded enough to say. */
type VideoShape = {
  aspect: number;
  chrome: number;
  hostPath: string;
  width: number;
};

/**
 * The panel's width for a video: the video's own width, or less where the
 * window is too small for it, so the panel is the video's shape with no
 * bands around the picture.
 */
function videoWidth({ aspect, chrome, width }: VideoShape) {
  const height = dialogMaxSize("height", LOOK_HEIGHT);
  return `max(${LOOK_MIN_WIDTH}, min(calc(88vw / var(--content-zoom)), ${width}px, calc((${height} - ${chrome}px) * ${aspect})))`;
}

/** The panel's height for a video, matching `videoWidth`. */
function videoHeight({ aspect, chrome, width }: VideoShape) {
  const most = dialogMaxSize("width", "calc(88vw / var(--content-zoom))");
  return `min(${dialogMaxSize("height", LOOK_HEIGHT)}, calc(${chrome}px + min(${most}, ${width}px) / ${aspect}))`;
}

/**
 * Sets the panel's enter or exit animation to grow out of, or shrink back
 * into, the file's icon on screen, the way the Finder's Quick Look does.
 * The dialog's own animation reads these, so it stays one transform and
 * opacity animation; with no place on screen to go to it only fades.
 */
function flyFrom(
  panel: HTMLElement,
  place: Element | null | undefined,
  phase: "enter" | "exit",
) {
  const prefix = `--tw-${phase}`;
  for (const name of ["translate-x", "translate-y", "scale"]) {
    panel.style.removeProperty(`${prefix}-${name}`);
  }
  if (!place?.isConnected) {
    return;
  }
  // The icon or thumbnail in the row rather than the whole row, which in a
  // list is a long thin strip.
  const icon = place.querySelector("img, svg") ?? place;
  const start = icon.getBoundingClientRect();
  const end = panel.getBoundingClientRect();
  const onScreen =
    start.width > 0 &&
    start.bottom > 0 &&
    start.right > 0 &&
    start.top < window.innerHeight &&
    start.left < window.innerWidth;
  if (!onScreen || end.width === 0 || panel.offsetWidth === 0) {
    return;
  }
  // The rects are on-screen px, and the panel's transform is in its own
  // layout px, which the app's zoom scales.
  const zoom = end.width / panel.offsetWidth;
  const x = (start.left + start.width / 2 - (end.left + end.width / 2)) / zoom;
  const y = (start.top + start.height / 2 - (end.top + end.height / 2)) / zoom;
  panel.style.setProperty(`${prefix}-translate-x`, `${x}px`);
  panel.style.setProperty(`${prefix}-translate-y`, `${y}px`);
  panel.style.setProperty(
    `${prefix}-scale`,
    String(Math.max(start.width / end.width, start.height / end.height)),
  );
}

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
 * The page under the panel drawn live, a page's file or a site: a page tab
 * in a group of its own, drawn into the slot the viewer gives it on the layer over the panel,
 * and closed as the panel moves off it or goes.
 */
function useLookedAtPage(url: string | undefined): ReactNode {
  const { setSlot } = useHostedPage({
    group: QUICK_LOOK_GROUP,
    host: {
      chrome: false,
      insideOverlay: true,
      isActive: true,
      layer: LOOK_GUEST_LAYER,
    },
    url,
  });
  return url === undefined ? undefined : (
    <div className="h-full" ref={setSlot} />
  );
}
