import { useTheme } from "@/client/components/theme-provider";
import { toast } from "@/client/lib/toast";
import { cn, osConventions } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type Capture, captureUrl } from "@/shared/captures";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue } from "jotai";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import {
  CAPTURE_UI_ATTRIBUTE,
  captureContext,
  capturesChanged,
  captureEditorAtom,
  captureRequestAtom,
  captureThumbnailAtom,
  nextPaint,
  openCaptureEditor,
} from "./capture-store";

const CaptureEditor = lazy(() =>
  import("./capture-editor").then((m) => ({ default: m.CaptureEditor })),
);

/** How long the white flash over the window lasts. */
const FLASH_MS = 120;
/** How long the picture takes to shrink into the corner. */
const FLY_MS = 420;
/** How long the thumbnail waits in the corner while the pointer is off it. */
const THUMBNAIL_MS = 6000;
/** The thumbnail's size and its distance from the corner, in layout px. */
const THUMB = { gap: 12, h: 140, w: 224 };

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
  const [flash, setFlash] = useState(false);
  // The capture shrinking into the corner, and whether it has started moving.
  const [flying, setFlying] = useState<Capture | null>(null);
  const [landing, setLanding] = useState(false);
  const [pointedAt, setPointedAt] = useState(false);
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
        capturesChanged();
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
        setFlash(true);
        setTimeout(() => {
          setFlash(false);
        }, FLASH_MS);
        await nextPaint();
        setLanding(true);
        await new Promise((resolve) => {
          setTimeout(resolve, FLY_MS);
        });
        setThumbnail(capture);
        setFlying(null);
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
    if (!thumbnail || pointedAt || editing) {
      return;
    }
    const timer = setTimeout(() => {
      setThumbnail(null);
    }, THUMBNAIL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [editing, pointedAt, setThumbnail, thumbnail]);

  const { showInFileManager } = osConventions();
  const flight = landing
    ? {
        borderRadius: 8,
        height: THUMB.h,
        left: size.width - THUMB.gap - THUMB.w,
        top: size.height - THUMB.gap - THUMB.h,
        width: THUMB.w,
      }
    : {
        borderRadius: 0,
        height: size.height,
        left: 0,
        top: 0,
        width: size.width,
      };

  return (
    <div
      className="pointer-events-none absolute inset-0 *:pointer-events-auto"
      ref={rootRef}
      {...{ [CAPTURE_UI_ATTRIBUTE]: "" }}
    >
      {flying && (
        <img
          alt=""
          className="pointer-events-none! absolute z-[60] object-cover object-left-top shadow-2xl ring-1 ring-black/15"
          src={captureUrl(flying)}
          style={{
            ...flight,
            transition: `all ${FLY_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
          }}
        />
      )}
      {flash && (
        <div className="pointer-events-none! absolute inset-0 z-[61] bg-white/40" />
      )}
      {thumbnail && !hidden && !editing && (
        <div
          className="group absolute right-3 bottom-3 z-50 w-56 overflow-hidden rounded-lg bg-background shadow-2xl ring-1 ring-black/15"
          onPointerEnter={() => {
            setPointedAt(true);
          }}
          onPointerLeave={() => {
            setPointedAt(false);
          }}
        >
          <img
            alt="The newest capture"
            className="block aspect-[16/10] w-full object-cover object-left-top"
            draggable={false}
            src={captureUrl(thumbnail)}
          />
          <div
            className={cn(
              "absolute inset-0 flex flex-col justify-between bg-black/45 p-2 opacity-0 transition-opacity",
              "group-hover:opacity-100 has-focus-visible:opacity-100",
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
              <button
                className="flex-1 rounded-md bg-white py-1 text-xs font-medium text-black hover:bg-white/90"
                onClick={() => {
                  void rpcClient.captures.copy
                    .call({ name: thumbnail.name })
                    .then(() => toast.success("Copied the capture"));
                }}
                type="button"
              >
                Copy
              </button>
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
