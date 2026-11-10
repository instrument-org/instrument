import { useCaptures } from "@/client/components/captures/capture-store";
import { CapturesGrid } from "@/client/components/captures/captures-grid";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { cn, osConventions } from "@/client/lib/utils";
import {
  buildDescription,
  buildLabel,
  type Capture,
  type CaptureBuild,
  isSameBuild,
} from "@/shared/captures";
import { CameraIcon } from "@phosphor-icons/react/Camera";
import { ImageIcon } from "@phosphor-icons/react/Image";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { XIcon } from "@phosphor-icons/react/X";

import { type ReactNode, useState } from "react";

/** The least the note's field shrinks to: its `min-h-24`. */
const NOTE_FLOOR = "6rem";
/** The row with the plus: `size-7` and `pb-1.5`. */
const ROW_HEIGHT = "2.125rem";
/** One line of pictures: `h-16` and `py-1`. */
const IMAGES_HEIGHT = "4.5rem";

/** An image in the note, and the capture it came from when it is one. */
export type NoteImage = {
  capture?: Capture;
  id: string;
  name: string;
  src: string;
};

/**
 * The note's field with what goes with it inside: the words, then the
 * pictures, then a row with the plus that adds more and `trailing` at its
 * right. In developer mode a capture wears the build that took it, amber when
 * that isn't the build sending. The field takes the room left to it and
 * scrolls inside, while the pictures and the row below it stay in view.
 */
export function NoteWithAttachments({
  build,
  canAdd,
  children,
  images,
  onAddCaptures,
  onAddImages,
  onRemove,
  problems,
  status,
  trailing,
}: {
  /** The build running, when developer mode shows captures' builds. */
  build?: CaptureBuild;
  canAdd: boolean;
  /** The note's own text field. */
  children: ReactNode;
  images: readonly NoteImage[];
  /** Opens the captures to pick from, in developer mode only. */
  onAddCaptures?: () => void;
  onAddImages: () => void;
  onRemove: (id: string) => void;
  problems: readonly string[];
  /** Shown in the row in place of the line about adding images. */
  status?: ReactNode;
  /** At the right of the row below the field. */
  trailing?: ReactNode;
}) {
  const others = build
    ? images.filter(
        (image) =>
          image.capture?.meta && !isSameBuild(image.capture.meta.build, build),
      )
    : [];
  const otherBuilds = [
    ...new Set(
      others.flatMap((image) =>
        image.capture?.meta ? [buildDescription(image.capture.meta.build)] : [],
      ),
    ),
  ];

  const plus = (
    <Button
      aria-label="Add images"
      className="size-7 rounded-full"
      disabled={!canAdd}
      onClick={onAddCaptures ? undefined : onAddImages}
      size="icon"
      variant="ghost"
    >
      <PlusIcon className="size-4" />
    </Button>
  );

  return (
    // The field grows with its words and gives them back when the dialog runs
    // out of room, while the rows below it keep their height. The floor is
    // spelled out because a column's item can shrink no further than its
    // laid-out height, which here is all of the words.
    <div
      className="flex flex-col gap-2"
      style={{
        minHeight: `calc(${NOTE_FLOOR} + ${ROW_HEIGHT}${images.length > 0 ? ` + ${IMAGES_HEIGHT}` : ""})`,
      }}
    >
      <div
        className={cn(
          "flex min-h-0 flex-col rounded-xl bg-linear-to-b from-white to-[#fafaf9] shadow-sm",
          "dark:border dark:border-input dark:bg-input/30 dark:bg-none dark:from-transparent dark:to-transparent",
          "focus-within:outline-[3px] focus-within:outline-offset-0 focus-within:outline-ring/50 focus-within:[outline-style:solid]",
        )}
      >
        {children}
        {images.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-3 px-3 pt-1 pb-1">
            {images.map((image) => {
              const meta = image.capture?.meta;
              const other = build && meta && !isSameBuild(meta.build, build);
              return (
                <div className="relative" key={image.id}>
                  <img
                    alt={image.name}
                    className="block h-16 w-24 rounded-md border border-border bg-muted object-cover object-top"
                    src={image.src}
                  />
                  {build && meta && (
                    <span
                      className={cn(
                        "absolute bottom-1 left-1 max-w-22 truncate rounded px-1 font-mono text-[10px] leading-4 text-white",
                        other ? "bg-warning-500" : "bg-black/55",
                      )}
                      title={buildDescription(meta.build)}
                    >
                      {buildLabel(meta.build)}
                    </span>
                  )}
                  <button
                    aria-label={`Remove ${image.name}`}
                    className="absolute -top-1.5 -right-1.5 grid size-4.5 place-items-center rounded-full bg-foreground text-background hover:bg-foreground/80"
                    onClick={() => {
                      onRemove(image.id);
                    }}
                    type="button"
                  >
                    <XIcon className="size-2.5" weight="bold" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1 px-1.5 pb-1.5">
          {onAddCaptures ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>{plus}</DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={onAddCaptures}>
                  <CameraIcon />
                  Captures…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onAddImages}>
                  <ImageIcon />
                  Images from{" "}
                  {osConventions().thisComputer.replace(/^this /, "your ")}…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            plus
          )}
          {status ??
            (images.length === 0 && (
              <span className="truncate text-xs text-muted-foreground">
                Add images, or paste or drop them here
              </span>
            ))}
          {trailing}
        </div>
      </div>
      {otherBuilds.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-warning-700">
          <WarningCircleIcon className="mt-px size-3.5 shrink-0" />
          {others.length === 1
            ? `This capture is from ${otherBuilds.join(", ")}, not the build sending it.`
            : `These captures are from ${otherBuilds.join(", ")}, not the build sending them.`}
        </p>
      )}
      {problems.map((line) => (
        <p
          className="flex items-start gap-1.5 text-xs text-destructive"
          key={line}
        >
          <WarningCircleIcon className="mt-px size-3.5 shrink-0" />
          {line}
        </p>
      ))}
    </div>
  );
}

/** The developer's captures to pick from, newest first, at most `room` of them. */
export function CapturePicker({
  onClose,
  onPick,
  room,
}: {
  onClose: () => void;
  onPick: (captures: Capture[]) => void;
  room: number;
}) {
  const captures = useCaptures();
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
    >
      <DialogContent
        className="flex flex-col gap-0 p-0"
        maxHeight="40rem"
        maxWidth="38rem"
      >
        <div className="px-6 pt-6 pb-4">
          <DialogTitle>Add captures</DialogTitle>
        </div>
        <DialogBody className="mx-0 px-6">
          {captures.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              You don't have any captures yet.
            </p>
          ) : (
            <CapturesGrid
              captures={captures}
              onPick={(capture) => {
                setPicked((current) =>
                  current.includes(capture.name)
                    ? current.filter((name) => name !== capture.name)
                    : current.length < room
                      ? [...current, capture.name]
                      : current,
                );
              }}
              selected={new Set(picked)}
            />
          )}
        </DialogBody>
        <div className="flex items-center gap-2 px-6 pt-4 pb-6">
          <span className="flex-1 text-xs text-muted-foreground">
            {picked.length > 0 ? `${picked.length} of ${room} picked` : ""}
          </span>
          <Button onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={picked.length === 0}
            onClick={() => {
              onPick(
                picked.flatMap(
                  (name) =>
                    captures.find((capture) => capture.name === name) ?? [],
                ),
              );
              onClose();
            }}
            variant="brand"
          >
            Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
