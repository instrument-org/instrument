import { type ViewerFile } from "@/client/atoms/viewer-file";
import { useFileActionVisibility } from "@/client/hooks/use-file-action-visibility";
import { useFileDrag } from "@/client/hooks/use-file-drag";
import { useFileOpenControl } from "@/client/hooks/use-file-open-control";
import {
  FILE_MISSING_LABEL,
  useFilePresence,
} from "@/client/hooks/use-file-presence";
import { useImageArrival } from "@/client/hooks/use-image-arrival";
import { copyFileToClipboard, downloadFile } from "@/client/lib/file-actions";
import { cn } from "@/client/lib/utils";
import { ArrowLineDownIcon } from "@phosphor-icons/react/ArrowLineDown";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { ImageBrokenIcon } from "@phosphor-icons/react/ImageBroken";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useTimedFlag } from "../hooks/use-timed-flag";
import { CardVersionContext } from "./card-version";
import { formatByteSize } from "./extend/file-system";
import { FileActionsMenuItems } from "./file-actions-menu";
import { OpenFileButton } from "./open-file-button";
import {
  layoutPictureRows,
  PICTURE_GAP,
  type PictureShape,
  type PictureSlot,
  PLACEHOLDER_RATIO,
} from "./picture-rows-layout";
import { Button } from "./ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { contextMenuComponents } from "./ui/menu-components";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/**
 * Every picture's shape once it has been read, by its source, so a card drawn
 * again (a chat scrolled back to, a grid re-rendered) takes its own shape from
 * the first frame instead of the placeholder's.
 */
const knownShapes = new Map<string, PictureShape>();

function isSameShape(a: PictureShape | undefined, b: PictureShape | undefined) {
  return a?.width === b?.width && a?.height === b?.height;
}

/** The room a picture that is gone takes: its outline at the placeholder's shape, never large. */
const MISSING_SHAPE: PictureShape = { height: 160, width: 240 };

/** What a set of cards tells the rows they stand in: that a card is there, and its shape. */
const PictureRowsActionsContext = createContext<null | {
  register: (key: string) => () => void;
  report: (key: string, shape: PictureShape | undefined) => void;
}>(null);

/** Where each card in the rows goes, by its key. */
const PictureSlotsContext = createContext<null | ReadonlyMap<
  string,
  PictureSlot
>>(null);

/**
 * Lays the picture cards under it out in rows that share a height (see
 * `layoutPictureRows`), measured against its own width, so the rows follow the
 * chat's column as it resizes. `order` is the cards' keys in the order they
 * are drawn; a key whose card is not drawn takes no room.
 *
 * Spans rather than boxes, so the rows can stand in a paragraph of a message.
 */
export function PictureRows({
  children,
  order,
}: {
  children: React.ReactNode;
  order: readonly string[];
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  const [present, setPresent] = useState<ReadonlyMap<string, number>>(
    new Map(),
  );
  const [shapes, setShapes] = useState<ReadonlyMap<string, PictureShape>>(
    new Map(),
  );
  const [actions] = useState(() => ({
    register: (key: string) => {
      setPresent((current) =>
        new Map(current).set(key, (current.get(key) ?? 0) + 1),
      );
      return () => {
        setPresent((current) => {
          const next = new Map(current);
          const count = (next.get(key) ?? 1) - 1;
          if (count > 0) {
            next.set(key, count);
          } else {
            next.delete(key);
          }
          return next;
        });
      };
    },
    report: (key: string, shape: PictureShape | undefined) => {
      setShapes((current) => {
        if (isSameShape(current.get(key), shape)) {
          return current;
        }
        const next = new Map(current);
        if (shape) {
          next.set(key, shape);
        } else {
          next.delete(key);
        }
        return next;
      });
    },
  }));

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => {
      setWidth(element.clientWidth);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const keys = [...new Set(order)].filter((key) => present.has(key));
  const slots = layoutPictureRows(
    keys.map((key) => {
      const shape = shapes.get(key);
      return {
        ratio: shape ? shape.width / shape.height : PLACEHOLDER_RATIO,
        size: shape,
      };
    }),
    width,
  );
  const slotByKey = new Map(
    keys.flatMap((key, at) => {
      const slot = slots[at];
      return slot ? [[key, slot] as const] : [];
    }),
  );

  return (
    <span
      className="not-prose flex w-full flex-wrap items-start"
      data-slot="picture-rows"
      ref={ref}
      style={{ gap: PICTURE_GAP }}
    >
      <PictureRowsActionsContext value={actions}>
        <PictureSlotsContext value={slotByKey}>{children}</PictureSlotsContext>
      </PictureRowsActionsContext>
    </span>
  );
}

/**
 * Takes a card's place in the rows it stands in, and tells them its shape. A
 * card outside any rows (a picture in a table cell) is laid out by its own
 * box and gets no slot.
 */
function usePictureSlot(
  key: string,
  shape: PictureShape | undefined,
): { inRows: boolean; slot: PictureSlot | undefined } {
  const actions = useContext(PictureRowsActionsContext);
  const slots = useContext(PictureSlotsContext);

  useLayoutEffect(() => actions?.register(key), [actions, key]);
  useLayoutEffect(() => {
    actions?.report(key, shape);
  }, [actions, key, shape]);

  return { inRows: actions !== null, slot: slots?.get(key) };
}

/**
 * Reads a picture's shape from its own element as soon as the first bytes say
 * what it is, which is before it has finished arriving, so the card takes its
 * shape once and before anything is seen.
 */
function usePictureShape(src: string) {
  const [shape, setShape] = useState(() => knownShapes.get(src));
  const frameRef = useRef<number>(undefined);

  const settle = (element: HTMLImageElement) => {
    const { naturalHeight, naturalWidth } = element;
    if (naturalWidth <= 0 || naturalHeight <= 0) {
      return false;
    }
    const next = { height: naturalHeight, width: naturalWidth };
    knownShapes.set(src, next);
    setShape((current) =>
      current?.width === next.width && current.height === next.height
        ? current
        : next,
    );
    return true;
  };

  useEffect(
    () => () => {
      if (frameRef.current !== undefined) {
        cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  return {
    shape,
    /** For the `<img>`'s ref: watches it until it knows its own size. */
    watch: (element: HTMLImageElement | null) => {
      if (frameRef.current !== undefined) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = undefined;
      }
      if (!element) {
        return;
      }
      const poll = () => {
        frameRef.current = settle(element)
          ? undefined
          : requestAnimationFrame(poll);
      };
      poll();
    },
    /** For the `<img>`'s load event, the last word on its size. */
    onLoad: (element: HTMLImageElement) => {
      settle(element);
    },
  };
}

/**
 * A picture a reply hands over, drawn naked at its own shape with one quiet
 * line under it: its name and size, where Copy, Save as… and Open take their
 * place beside the name on hover, so nothing is ever drawn over the picture
 * but its version. Pressing the picture opens it.
 *
 * Standing in `PictureRows`, it takes the slot the rows give it; anywhere else
 * it fills its box at its own shape, never past its own size.
 */
export function PictureCard({
  alt,
  file,
  isStreaming = false,
  layoutKey,
  onOpen,
}: {
  /** What the picture shows, where the reply said; its name otherwise. */
  alt?: string;
  file: ViewerFile;
  /**
   * The text naming it is still arriving: half a path fails the way a missing
   * file does, so until it settles a failure is drawn as the room it takes.
   */
  isStreaming?: boolean;
  /** The card's key in the rows it stands in; its path when left out. */
  layoutKey?: string;
  onOpen: () => void;
}) {
  const { filename, hostPath, url } = file;
  const { isMissing, ref, size } = useFilePresence<HTMLSpanElement>(url);
  const [failedSrc, setFailedSrc] = useState<string>();
  const isBroken = failedSrc === url;
  const picture = usePictureShape(url);
  const arrival = useImageArrival(url);
  const key = layoutKey ?? hostPath;
  const { inRows, slot } = usePictureSlot(
    key,
    isMissing ? MISSING_SHAPE : isBroken ? undefined : picture.shape,
  );
  const version = useContext(CardVersionContext);
  const dragProps = useFileDrag(file);
  // The open target is asked for once the controls are about to be wanted.
  const [resolveOpenTarget, setResolveOpenTarget] = useState(false);

  const ratio = picture.shape
    ? picture.shape.width / picture.shape.height
    : PLACEHOLDER_RATIO;
  const outer: React.CSSProperties = slot
    ? { marginInlineEnd: slot.end, width: slot.width }
    : inRows
      ? { width: 0 }
      : {
          maxWidth: isMissing ? MISSING_SHAPE.width : picture.shape?.width,
          width: "100%",
        };
  const box: React.CSSProperties = slot
    ? { height: slot.height }
    : { aspectRatio: isMissing ? PLACEHOLDER_RATIO : ratio };

  if (isStreaming && (isMissing || isBroken)) {
    return <PicturePlaceholder layoutKey={key} />;
  }

  if (isMissing) {
    return (
      <span
        className="not-prose flex min-w-0 shrink-0 flex-col select-none"
        data-slot="picture-card"
        ref={ref}
        style={outer}
      >
        <span
          className="grid place-items-center rounded-xl border border-dashed border-border bg-muted/40"
          style={box}
        >
          <ImageBrokenIcon className="size-5.5 text-muted-foreground/60" />
        </span>
        <span className="mt-1 flex h-6 min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{filename}</span>
          <span className="shrink-0 whitespace-pre">
            · {FILE_MISSING_LABEL}
          </span>
        </span>
      </span>
    );
  }

  const card = (
    <span
      className="group/picture not-prose flex min-w-0 shrink-0 flex-col select-none"
      data-slot="picture-card"
      onFocus={() => {
        setResolveOpenTarget(true);
      }}
      onMouseEnter={() => {
        setResolveOpenTarget(true);
      }}
      ref={ref}
      style={outer}
      {...dragProps}
    >
      <span
        className="relative block overflow-hidden rounded-xl bg-muted/60 ring-1 ring-black/5 dark:ring-white/10"
        style={box}
      >
        {isBroken ? (
          <span className="grid size-full place-items-center">
            <ImageBrokenIcon className="size-5.5 text-muted-foreground/60" />
          </span>
        ) : (
          <img
            alt={alt || filename}
            className={cn("block size-full object-cover", arrival.className)}
            draggable={false}
            onError={() => {
              setFailedSrc(url);
            }}
            onLoad={(event) => {
              picture.onLoad(event.currentTarget);
              arrival.onLoad();
            }}
            ref={(element) => {
              arrival.attach(element);
              picture.watch(element);
            }}
            src={url}
          />
        )}
        <button
          aria-label={`Open ${filename}`}
          className="absolute inset-0 size-full cursor-pointer rounded-xl outline-hidden focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:[outline-style:solid]"
          onClick={onOpen}
          type="button"
        />
        {version && (
          <span className="pointer-events-none absolute top-2.5 right-2.5 inline-flex h-5 items-center rounded-md bg-black/55 px-1.5 text-xs font-semibold text-white tabular-nums backdrop-blur">
            v{version.number}
          </span>
        )}
      </span>
      <PictureLine
        canCopy={!isBroken}
        file={file}
        name={filename}
        resolveOpenTarget={resolveOpenTarget}
        size={size}
        title={hostPath}
      />
    </span>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <ContextMenuContent>
        <FileActionsMenuItems
          canCopy={!isBroken}
          file={file}
          menuComponents={contextMenuComponents}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The line under a picture: its name and size at rest, joined by the controls
 * while the card is hovered or has focus. The name gives way before the size
 * does, and the size wraps onto a line that is not shown once even a short
 * name leaves it no room, so it is there whole or not at all.
 */
function PictureLine({
  canCopy,
  file,
  name,
  resolveOpenTarget,
  size,
  title,
}: {
  canCopy: boolean;
  file: ViewerFile;
  name: string;
  resolveOpenTarget: boolean;
  /** In bytes, once it is known. */
  size?: number;
  title: string;
}) {
  const fileActions = useFileActionVisibility(file);
  const openControl = useFileOpenControl(resolveOpenTarget ? file : undefined);
  const { active: copied, trigger: triggerCopied } = useTimedFlag();
  const showCopy = fileActions.showCopy && canCopy;

  const handleCopy = async () => {
    try {
      await copyFileToClipboard({ hostPath: file.hostPath, isImage: true });
      triggerCopied();
    } catch {
      // copyFileToClipboard already toasts on error
    }
  };

  return (
    <span className="@container/picture-line mt-1 flex h-6 min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <span className="flex h-6 min-w-0 flex-1 flex-wrap overflow-hidden leading-6">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="max-w-max min-w-12 shrink grow basis-0 truncate group-hover/picture:text-foreground">
              {name}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <span className="break-all">{title}</span>
          </TooltipContent>
        </Tooltip>
        {size !== undefined && (
          <span className="shrink-0 whitespace-pre" data-slot="file-size">
            {" · "}
            {formatByteSize(size)}
          </span>
        )}
      </span>
      {/* No width until the card is hovered or has focus, so the name has the
          line until the controls are wanted. Collapsed rather than removed, so
          they stay in the tab order; held open while a menu of theirs is. */}
      <span
        className="-ml-1 flex w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0 group-focus-within/picture:ml-0 group-focus-within/picture:w-auto group-focus-within/picture:opacity-100 group-hover/picture:ml-0 group-hover/picture:w-auto group-hover/picture:opacity-100 has-data-[state=open]:ml-0 has-data-[state=open]:w-auto has-data-[state=open]:opacity-100"
        data-slot="picture-actions"
      >
        {showCopy && (
          <LineButton
            icon={
              copied ? (
                <CheckIcon className="size-3.5 shrink-0" />
              ) : (
                <CopyIcon className="size-3.5 shrink-0" />
              )
            }
            label="Copy"
            onClick={() => {
              void handleCopy();
            }}
          />
        )}
        {fileActions.showDownload && (
          <LineButton
            icon={<ArrowLineDownIcon className="size-3.5 shrink-0" />}
            label="Save as…"
            onClick={() => {
              void downloadFile(file);
            }}
          />
        )}
        <OpenFileButton
          className="h-6 rounded-md px-1.5 text-foreground has-[>svg]:px-1.5"
          control={openControl}
          dropdownClassName="h-6 rounded-md"
          file={file}
          iconClassName="size-3.5 shrink-0"
          labelClassName="hidden @md/picture-line:inline"
          size="xs"
          variant="ghost"
        />
      </span>
    </span>
  );
}

/** A control on a picture's line: its label once the line has room, its icon always. */
function LineButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      className="h-6 rounded-md px-1.5 text-foreground has-[>svg]:px-1.5"
      onClick={onClick}
      size="xs"
      type="button"
      variant="ghost"
    >
      {icon}
      <span className="hidden @md/picture-line:inline">{label}</span>
    </Button>
  );
}

/**
 * The room a picture still being named will take, in the rows it is going to
 * stand in: the placeholder's shape and an empty line, so the rows are already
 * laid out for it when its card replaces this.
 */
export function PicturePlaceholder({ layoutKey }: { layoutKey: string }) {
  const { inRows, slot } = usePictureSlot(layoutKey, undefined);
  return (
    <span
      className="not-prose flex min-w-0 shrink-0 flex-col"
      data-slot="picture-card"
      style={
        slot
          ? { marginInlineEnd: slot.end, width: slot.width }
          : { width: inRows ? 0 : "100%" }
      }
    >
      <span
        className="block animate-pulse rounded-xl bg-accent"
        style={
          slot ? { height: slot.height } : { aspectRatio: PLACEHOLDER_RATIO }
        }
      />
      <span className="mt-1 block h-6" />
    </span>
  );
}
