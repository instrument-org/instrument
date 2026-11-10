import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { toast } from "@/client/lib/toast";
import { cn, commandKeyHeld, osConventions } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  buildDescription,
  type Capture,
  type CaptureElement,
  captureUrl,
} from "@/shared/captures";
import { ArrowUpRightIcon } from "@phosphor-icons/react/ArrowUpRight";
import { CropIcon } from "@phosphor-icons/react/Crop";
import { DropHalfIcon } from "@phosphor-icons/react/DropHalf";
import { RectangleIcon } from "@phosphor-icons/react/Rectangle";
import { useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { type ReactNode, useEffect, useRef, useState } from "react";

import {
  captureEditorAtom,
  capturesChanged,
  captureThumbnailAtom,
} from "./capture-store";

type Rect = { h: number; w: number; x: number; y: number };
type Point = { x: number; y: number };
type Tool = "arrow" | "blur" | "box" | "crop";
type Mark =
  | { from: Point; kind: "arrow"; to: Point }
  | { kind: "blur" | "box"; rect: Rect };

const MARK_COLOR = "#ef4444";
/** A press that moves less than this, in the picture's pixels, is a click. */
const CLICK_SLOP = 6;
/** How coarse a blur's blocks are, as a share of the picture's width. */
const BLUR_BLOCK = 1 / 120;

function rectBetween(a: Point, b: Point): Rect {
  return {
    h: Math.abs(b.y - a.y),
    w: Math.abs(b.x - a.x),
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
  };
}

/**
 * The elements recorded at the moment of capture that hold `point`, smallest
 * first, one per distinct box (a wrapper the size of its child adds nothing).
 */
function elementsAt(
  elements: readonly CaptureElement[],
  point: Point,
): CaptureElement[] {
  const holding = elements
    .filter(
      (element) =>
        point.x >= element.x &&
        point.y >= element.y &&
        point.x <= element.x + element.w &&
        point.y <= element.y + element.h,
    )
    .toSorted((a, b) => a.w * a.h - b.w * b.h);
  const seen = new Set<string>();
  return holding.filter((element) => {
    const box = `${element.x},${element.y},${element.w},${element.h}`;
    if (seen.has(box)) {
      return false;
    }
    seen.add(box);
    return true;
  });
}

/** Draws the picture with its marks, shifted so `origin` lands at the canvas's corner. */
function drawPicture(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  marks: readonly Mark[],
  origin: Point,
) {
  ctx.drawImage(image, -origin.x, -origin.y);
  const line = Math.max(3, image.naturalWidth / 400);
  for (const mark of marks) {
    if (mark.kind === "blur") {
      const { h, w, x, y } = mark.rect;
      const block = Math.max(4, image.naturalWidth * BLUR_BLOCK);
      const small = document.createElement("canvas");
      small.width = Math.max(1, Math.round(w / block));
      small.height = Math.max(1, Math.round(h / block));
      small
        .getContext("2d")
        ?.drawImage(image, x, y, w, h, 0, 0, small.width, small.height);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, x - origin.x, y - origin.y, w, h);
      ctx.restore();
    }
  }
  ctx.strokeStyle = MARK_COLOR;
  ctx.fillStyle = MARK_COLOR;
  ctx.lineWidth = line;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const mark of marks) {
    if (mark.kind === "box") {
      const { h, w, x, y } = mark.rect;
      ctx.strokeRect(x - origin.x, y - origin.y, w, h);
    }
    if (mark.kind === "arrow") {
      const from = { x: mark.from.x - origin.x, y: mark.from.y - origin.y };
      const to = { x: mark.to.x - origin.x, y: mark.to.y - origin.y };
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const head = line * 5;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(
        to.x - Math.cos(angle) * head * 0.8,
        to.y - Math.sin(angle) * head * 0.8,
      );
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(
        to.x - head * Math.cos(angle - 0.45),
        to.y - head * Math.sin(angle - 0.45),
      );
      ctx.lineTo(
        to.x - head * Math.cos(angle + 0.45),
        to.y - head * Math.sin(angle + 0.45),
      );
      ctx.closePath();
      ctx.fill();
    }
  }
}

/** The edited picture: cropped, with its marks drawn in. */
function exportPicture(
  image: HTMLImageElement,
  marks: readonly Mark[],
  crop: Rect | null,
) {
  const area = crop ?? {
    h: image.naturalHeight,
    w: image.naturalWidth,
    x: 0,
    y: 0,
  };
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(area.w));
  canvas.height = Math.max(1, Math.round(area.h));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    drawPicture(ctx, image, marks, area);
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("The picture couldn't be made"));
      }
    }, "image/png");
  });
}

function ToolButton({
  children,
  label,
  on,
  onClick,
}: {
  children: ReactNode;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={on}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        on
          ? "bg-foreground/8 font-medium text-foreground"
          : "text-foreground/75 hover:bg-foreground/5",
      )}
      onClick={onClick}
      type="button"
    >
      {children}
      {label}
    </button>
  );
}

/**
 * A capture opened to crop and mark up. The crop snaps to an element that was
 * on screen when the capture was taken on a click, or takes any area dragged;
 * Box, Arrow and Blur draw over it. Done saves over the capture, keeping its
 * first picture for Revert.
 */
export function CaptureEditor({ capture }: { capture: Capture }) {
  const setEditing = useSetAtom(captureEditorAtom);
  const setThumbnail = useSetAtom(captureThumbnailAtom);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<Tool>("crop");
  const [crop, setCrop] = useState<Rect | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [press, setPress] = useState<{ at: Point; now: Point } | null>(null);
  // The elements under the pointer, smallest first, and how many steps out
  // from the smallest the crop would take (↑ and ↓ move it).
  const [underPointer, setUnderPointer] = useState<CaptureElement[]>([]);
  const [outward, setOutward] = useState(0);
  const hovered =
    underPointer[Math.min(outward, underPointer.length - 1)] ?? undefined;
  const [saving, setSaving] = useState(false);
  const elements = capture.meta?.elements ?? [];
  const changed = crop !== null || marks.length > 0;
  const { showInFileManager } = osConventions();
  const { data: canRevert } = useQuery(
    rpcClient.captures.hasOriginal.queryOptions({
      input: { name: capture.name },
    }),
  );

  const close = () => {
    setEditing(null);
  };

  useEffect(() => {
    const next = new Image();
    next.crossOrigin = "anonymous";
    next.addEventListener("load", () => {
      setImage(next);
    });
    next.src = captureUrl(capture);
  }, [capture]);

  // The picture with its marks, a draft of the one being drawn, the crop's
  // dimmed surround, and the element a click would crop to.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !image) {
      return;
    }
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const draft: Mark[] = [];
    let cropShown = crop;
    if (press) {
      const moved =
        Math.hypot(press.now.x - press.at.x, press.now.y - press.at.y) >
        CLICK_SLOP;
      if (moved && tool === "crop") {
        cropShown = rectBetween(press.at, press.now);
      } else if (moved && tool === "arrow") {
        draft.push({ from: press.at, kind: "arrow", to: press.now });
      } else if (moved && (tool === "box" || tool === "blur")) {
        draft.push({ kind: tool, rect: rectBetween(press.at, press.now) });
      }
    }
    drawPicture(ctx, image, [...marks, ...draft], { x: 0, y: 0 });
    const line = Math.max(2, image.naturalWidth / 600);
    if (cropShown) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.rect(cropShown.x, cropShown.y, cropShown.w, cropShown.h);
      ctx.fill("evenodd");
      ctx.strokeStyle = "white";
      ctx.lineWidth = line;
      ctx.strokeRect(cropShown.x, cropShown.y, cropShown.w, cropShown.h);
      ctx.restore();
    }
    if (tool === "crop" && !press && hovered) {
      ctx.save();
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = line;
      ctx.setLineDash([line * 3, line * 2]);
      ctx.strokeRect(hovered.x, hovered.y, hovered.w, hovered.h);
      ctx.restore();
    }
  }, [crop, hovered, image, marks, press, tool]);

  const pointOf = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    const canvas = event.currentTarget;
    return {
      x: ((event.clientX - rect.left) * canvas.width) / rect.width,
      y: ((event.clientY - rect.top) * canvas.height) / rect.height,
    };
  };

  const finishPress = (end: Point) => {
    if (!press) {
      return;
    }
    const moved =
      Math.hypot(end.x - press.at.x, end.y - press.at.y) > CLICK_SLOP;
    setPress(null);
    if (tool === "crop") {
      if (moved) {
        setCrop(rectBetween(press.at, end));
      } else {
        const holding = elementsAt(elements, end);
        const element = holding[Math.min(outward, holding.length - 1)];
        setCrop(
          element
            ? { h: element.h, w: element.w, x: element.x, y: element.y }
            : null,
        );
      }
      return;
    }
    if (!moved) {
      return;
    }
    setMarks((current) => [
      ...current,
      tool === "arrow"
        ? { from: press.at, kind: "arrow", to: end }
        : { kind: tool, rect: rectBetween(press.at, end) },
    ]);
  };

  const undo = () => {
    if (marks.length > 0) {
      setMarks((current) => current.slice(0, -1));
    } else {
      setCrop(null);
    }
  };

  const save = async () => {
    if (!image || !changed) {
      close();
      return;
    }
    setSaving(true);
    try {
      const saved = await rpcClient.captures.saveEdit.call({
        data: await exportPicture(image, marks, crop),
        name: capture.name,
      });
      setThumbnail((current) =>
        current?.name === saved.name ? saved : current,
      );
      capturesChanged();
      close();
    } catch (error) {
      toast.error("Couldn't save the capture", { cause: error });
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      if (image && changed) {
        const blob = await exportPicture(image, marks, crop);
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
      } else {
        await rpcClient.captures.copy.call({ name: capture.name });
      }
      toast.success("Copied the capture");
    } catch (error) {
      toast.error("Couldn't copy the capture", { cause: error });
    }
  };

  const revert = async () => {
    try {
      const reverted = await rpcClient.captures.revert.call({
        name: capture.name,
      });
      setThumbnail((current) =>
        current?.name === reverted.name ? reverted : current,
      );
      capturesChanged();
      close();
    } catch (error) {
      toast.error("Couldn't revert the capture", { cause: error });
    }
  };

  const meta = capture.meta;
  const facts = meta
    ? [
        buildDescription(meta.build),
        [meta.screen, meta.chatTitle].filter(Boolean).join(" · "),
        `${meta.window.width} × ${meta.window.height} at ${Math.round(meta.zoom * 100)}%`,
        meta.theme === "dark" ? "Dark" : "Light",
      ]
    : [];

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
      open
    >
      <DialogContent
        className="flex flex-col gap-0 p-0"
        maxHeight="56rem"
        maxWidth="84rem"
        onKeyDown={(event) => {
          if (commandKeyHeld(event) && event.key === "z") {
            event.preventDefault();
            undo();
          }
          if (
            tool === "crop" &&
            (event.key === "ArrowUp" || event.key === "ArrowDown")
          ) {
            event.preventDefault();
            setOutward((current) =>
              Math.max(
                0,
                Math.min(
                  underPointer.length - 1,
                  current + (event.key === "ArrowUp" ? 1 : -1),
                ),
              ),
            );
          }
          if (
            event.key === "Enter" &&
            !commandKeyHeld(event) &&
            !(event.target instanceof HTMLButtonElement)
          ) {
            event.preventDefault();
            void save();
          }
        }}
        showCloseButton={false}
        style={{ height: "56rem", width: "84rem" }}
      >
        <DialogTitle className="sr-only">Edit capture</DialogTitle>
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
          <ToolButton
            label="Crop"
            on={tool === "crop"}
            onClick={() => {
              setTool("crop");
            }}
          >
            <CropIcon className="size-4" />
          </ToolButton>
          <ToolButton
            label="Box"
            on={tool === "box"}
            onClick={() => {
              setTool("box");
            }}
          >
            <RectangleIcon className="size-4" />
          </ToolButton>
          <ToolButton
            label="Arrow"
            on={tool === "arrow"}
            onClick={() => {
              setTool("arrow");
            }}
          >
            <ArrowUpRightIcon className="size-4" />
          </ToolButton>
          <ToolButton
            label="Blur"
            on={tool === "blur"}
            onClick={() => {
              setTool("blur");
            }}
          >
            <DropHalfIcon className="size-4" />
          </ToolButton>
          <span className="min-w-0 flex-1 truncate px-3 text-center font-mono text-[11px] text-muted-foreground">
            {capture.name}
          </span>
          <Button
            onClick={() => {
              void copy();
            }}
            size="sm"
            variant="outline"
          >
            Copy
          </Button>
          <Button
            onClick={() => {
              void rpcClient.captures.show.call({ name: capture.name });
            }}
            size="sm"
            variant="ghost"
          >
            {showInFileManager}
          </Button>
          <Button onClick={close} size="sm" variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={() => {
              void save();
            }}
            size="sm"
            variant="brand"
          >
            Done
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-foreground/[0.04] p-6">
          <canvas
            className="block max-h-full max-w-full rounded-sm shadow-md ring-1 ring-black/10"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              const at = pointOf(event);
              setPress({ at, now: at });
            }}
            onPointerLeave={() => {
              setUnderPointer([]);
            }}
            onPointerMove={(event) => {
              const now = pointOf(event);
              if (press) {
                setPress({ ...press, now });
              } else if (tool === "crop") {
                const next = elementsAt(elements, now);
                // A step out holds while the pointer stays on the same element.
                if (next[0] !== underPointer[0]) {
                  setOutward(0);
                }
                setUnderPointer(next);
              }
            }}
            onPointerUp={(event) => {
              finishPress(pointOf(event));
            }}
            ref={canvasRef}
            style={{ cursor: "crosshair" }}
          />
        </div>
        <div className="flex h-9 shrink-0 items-center gap-4 border-t border-border px-4 text-xs text-muted-foreground">
          {facts.map((fact) => (
            <span className="truncate" key={fact}>
              {fact}
            </span>
          ))}
          <span className="flex-1" />
          {hovered && tool === "crop" && !press && (
            <span className="truncate">
              Click to crop to {hovered.label} · ↑ or ↓ for a bigger or smaller
              area
            </span>
          )}
          {canRevert && (
            <button
              className="hover:text-foreground"
              onClick={() => {
                void revert();
              }}
              type="button"
            >
              Revert to original
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
