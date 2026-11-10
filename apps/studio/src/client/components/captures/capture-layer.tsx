import { useTheme } from "@/client/components/theme-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { toast } from "@/client/lib/toast";
import { cn, osConventions } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type Capture, captureUrl } from "@/shared/captures";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import {
  CAPTURE_UI_ATTRIBUTE,
  captureContext,
  capturesChanged,
  copyCaptureText,
  captureEditorAtom,
  captureRequestAtom,
  captureThumbnailAtom,
  nextPaint,
  openCaptureEditor,
} from "./capture-store";
import { copyCaptureImage } from "./capture-stamp";

const CaptureEditor = lazy(() =>
  import("./capture-editor").then((m) => ({ default: m.CaptureEditor })),
);

/** How long the white flash over the window takes to fade. */
const FLASH_MS = 220;
/** How long the picture takes to shrink into the corner. */
const FLY_MS = 520;
/** How long the thumbnail waits in the corner while the pointer is off it. */
const THUMBNAIL_MS = 6000;
/** The thumbnail's width and its distance from the corner, in layout px. */
const THUMB = { gap: 12, w: 224 };
/** How far the thumbnail is dragged right before letting go sends it away. */
const THROW_PX = 60;
/** How long it takes to slide out once thrown. */
const THROW_MS = 180;

/** Puts a capture's picture on the clipboard. */
async function copyImage(capture: Capture) {
  try {
    await copyCaptureImage(capture);
    toast.success("Copied the capture");
  } catch (error) {
    toast.error("Couldn't copy the capture", { cause: error });
  }
}

/** Loads a picture before it is shown, so the shrink never starts on a blank. */
function loaded(src: string) {
  const image = new Image();
  image.src = src;
  return image.decode().catch(() => undefined);
}

/**
 * Developer captures in one window: takes one when asked (the shortcut, the
 * strip's button), with the corner thumbnail hidden first so no capture shows
 * the one before it, shrinks the picture from the whole window into the
 * corner, leaves it there a while to copy, edit or find, and shows the editor
 * when one is opened.
 */
export function CaptureLayer() {
  const request = useAtomValue(captureRequestAtom);
  const [thumbnail, setThumbnail] = useAtom(captureThumbnailAtom);
  const editing = useAtomValue(captureEditorAtom);
  const [hidden, setHidden] = useState(false);
  // The capture shrinking into the corner, and whether it has started moving.
  const [flying, setFlying] = useState<Capture | null>(null);
  const [landing, setLanding] = useState(false);
  const [pointedAt, setPointedAt] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // The thumbnail being dragged off to the right, and whether it was let go
  // far enough to go.
  const [swipe, setSwipe] = useState<{
    dx: number;
    from: number;
    thrown: boolean;
  } | null>(null);
  const [size, setSize] = useState({ height: 0, width: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const { data: workspace } = useQuery(
    rpcClient.workspaces.current.queryOptions(),
  );
  const handled = useRef(request);
  const busy = useRef(false);

  useEffect(() => {
    if (request === handled.current || busy.current) {
      return;
    }
    handled.current = request;
    busy.current = true;
    // Read before anything moves; what the capture UI draws is left out.
    const context = captureContext({
      theme: resolvedTheme,
      workspace: workspace?.name,
    });
    setHidden(true);
    void (async () => {
      try {
        const chatId = ChatIdSchema.safeParse(context.chatId);
        const [chatTitle] = await Promise.all([
          chatId.success
            ? rpcClient.workspace.chats.byId
                .call({ id: chatId.data })
                .then((chat) => chat?.title)
                .catch(() => undefined)
            : undefined,
          nextPaint(),
        ]);
        const capture = await rpcClient.captures.take.call({
          ...context,
          ...(chatTitle && { chatTitle }),
        });
        await loaded(captureUrl(capture));
        const root = rootRef.current;
        setSize({
          height: root?.offsetHeight ?? 0,
          width: root?.offsetWidth ?? 0,
        });
        setThumbnail(null);
        setLanding(false);
        setFlying(capture);
        setHidden(false);
        await nextPaint();
        // One render starts both the shrink and the flash fading, and nothing
        // renders again until it lands, so the flight runs undisturbed.
        setLanding(true);
        await new Promise((resolve) => {
          setTimeout(resolve, FLY_MS);
        });
        setThumbnail(capture);
        setFlying(null);
        capturesChanged();
      } catch (error) {
        toast.error("Couldn't capture the window", { cause: error });
      } finally {
        busy.current = false;
        setHidden(false);
      }
    })();
  }, [request, resolvedTheme, setThumbnail, workspace?.name]);

  // The thumbnail goes on its own after a while, unless the pointer is on it.
  useEffect(() => {
    if (!thumbnail || pointedAt || menuOpen || editing) {
      return;
    }
    const timer = setTimeout(() => {
      setThumbnail(null);
    }, THUMBNAIL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [editing, menuOpen, pointedAt, setThumbnail, thumbnail]);

  const { showInFileManager } = osConventions();
  // Only a transform moves, so the shrink runs on the compositor: the picture
  // keeps the window's size and is scaled to the thumbnail's width, landing
  // where the thumbnail, drawn at the window's shape, then takes its place.
  const scale = size.width > 0 ? THUMB.w / size.width : 1;
  const flight = landing
    ? `translate(${size.width - THUMB.gap - THUMB.w}px, ${size.height - THUMB.gap - size.height * scale}px) scale(${scale})`
    : "none";
  const shape = thumbnail?.meta?.edited ? undefined : thumbnail?.meta?.window;

  return (
    <div
      className="pointer-events-none absolute inset-0 *:pointer-events-auto"
      ref={rootRef}
      {...{ [CAPTURE_UI_ATTRIBUTE]: "" }}
    >
      {flying && (
        <img
          alt=""
          className="pointer-events-none! absolute top-0 left-0 z-[60] shadow-2xl ring-1 ring-black/15"
          src={captureUrl(flying)}
          style={{
            height: size.height,
            transform: flight,
            transformOrigin: "0 0",
            transition: `transform ${FLY_MS}ms cubic-bezier(0.34, 1.2, 0.5, 1)`,
            width: size.width,
            willChange: "transform",
          }}
        />
      )}
      {flying && (
        <div
          className="pointer-events-none! absolute inset-0 z-[61] bg-white/20"
          style={{
            opacity: landing ? 0 : 1,
            transition: `opacity ${FLASH_MS}ms ease-out`,
          }}
        />
      )}
      {thumbnail && !hidden && !editing && (
        <div
          className="group absolute right-3 bottom-3 z-50 w-56 touch-none overflow-hidden rounded-lg bg-background shadow-2xl ring-1 ring-black/15"
          onPointerCancel={() => {
            setSwipe(null);
          }}
          onPointerDown={(event) => {
            // The buttons on it take their own clicks.
            if (
              event.button !== 0 ||
              (event.target instanceof Element &&
                event.target.closest("button"))
            ) {
              return;
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            setSwipe({ dx: 0, from: event.clientX, thrown: false });
          }}
          onPointerEnter={() => {
            setPointedAt(true);
          }}
          onPointerLeave={() => {
            setPointedAt(false);
          }}
          onPointerMove={(event) => {
            if (swipe && !swipe.thrown) {
              setSwipe({
                ...swipe,
                dx: Math.max(0, event.clientX - swipe.from),
              });
            }
          }}
          onPointerUp={() => {
            if (!swipe || swipe.thrown) {
              return;
            }
            if (swipe.dx < THROW_PX) {
              setSwipe(null);
              return;
            }
            // Thrown off to the right: it slides out, then goes.
            setSwipe({ ...swipe, dx: THUMB.w + THUMB.gap * 2, thrown: true });
            setTimeout(() => {
              setThumbnail(null);
              setSwipe(null);
              setPointedAt(false);
            }, THROW_MS);
          }}
          style={{
            opacity: swipe?.thrown ? 0 : 1,
            transform: swipe ? `translateX(${swipe.dx}px)` : undefined,
            transition:
              swipe && !swipe.thrown && swipe.dx > 0
                ? "none"
                : `transform ${THROW_MS}ms ease-out, opacity ${THROW_MS}ms ease-out`,
          }}
        >
          <img
            alt="The newest capture"
            className="block w-full object-cover object-left-top"
            draggable={false}
            src={captureUrl(thumbnail, { small: true })}
            style={{
              aspectRatio: shape
                ? `${shape.width} / ${shape.height}`
                : "16 / 10",
            }}
          />
          <div
            className={cn(
              "absolute inset-0 flex flex-col justify-between bg-black/45 p-2 opacity-0 transition-opacity",
              "group-hover:opacity-100 has-focus-visible:opacity-100",
              menuOpen && "opacity-100",
            )}
          >
            <div className="flex justify-between">
              <button
                aria-label="Put away"
                className="grid size-6 place-items-center rounded-full bg-white/90 text-black hover:bg-white"
                onClick={() => {
                  setThumbnail(null);
                  setPointedAt(false);
                }}
                type="button"
              >
                <XIcon className="size-3" weight="bold" />
              </button>
              <button
                aria-label={showInFileManager}
                className="grid size-6 place-items-center rounded-full bg-white/90 text-black hover:bg-white"
                onClick={() => {
                  void rpcClient.captures.show.call({ name: thumbnail.name });
                }}
                title={showInFileManager}
                type="button"
              >
                <FolderSimpleIcon className="size-3.5" />
              </button>
            </div>
            <div className="flex gap-1.5">
              <div className="flex flex-1 overflow-hidden rounded-md bg-white text-xs font-medium text-black">
                <button
                  className="flex-1 py-1 hover:bg-black/5"
                  onClick={() => {
                    void copyImage(thumbnail);
                  }}
                  type="button"
                >
                  Copy
                </button>
                <DropdownMenu onOpenChange={setMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label="More ways to copy"
                      className="grid w-6 place-items-center border-l border-black/10 hover:bg-black/5"
                      type="button"
                    >
                      <CaretDownIcon className="size-3" weight="bold" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="top">
                    <DropdownMenuItem
                      onSelect={() => {
                        void copyImage(thumbnail);
                      }}
                    >
                      Copy image
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        void copyCaptureText(thumbnail.name, "agent");
                      }}
                    >
                      Copy for an agent
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        void copyCaptureText(thumbnail.name, "path");
                      }}
                    >
                      Copy path
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <button
                className="flex-1 rounded-md bg-white py-1 text-xs font-medium text-black hover:bg-white/90"
                onClick={() => {
                  setPointedAt(false);
                  openCaptureEditor(thumbnail);
                }}
                type="button"
              >
                Edit
              </button>
            </div>
          </div>
        </div>
      )}
      {editing && (
        <Suspense fallback={null}>
          <CaptureEditor capture={editing} />
        </Suspense>
      )}
    </div>
  );
}
