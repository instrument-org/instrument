import { type FeedbackRequest } from "@/client/atoms/report-dialog";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Spinner } from "@/client/components/ui/spinner";
import {
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Textarea } from "@/client/components/ui/textarea";
import {
  bytesGoing,
  formatSize,
  partState,
  toggleItem,
  togglePart,
} from "@/client/lib/feedback-selection";
import { shouldAttachClipboardItem } from "@/client/lib/paste-clipboard";
import { SENT_CLOSE_MS } from "@/client/lib/problem-reports";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  checkFeedbackImages,
  FEEDBACK_IMAGE_TYPES,
  IMAGE_HEAD_BYTES,
  MAX_FEEDBACK_IMAGES,
} from "@/shared/feedback-images";
import {
  FEEDBACK_TOO_LARGE,
  type FeedbackItem,
  MAX_REPORT_BYTES,
} from "@/shared/problem-reports";
import { APP_NAME } from "@instrument-org/shared";
import { type Icon } from "@phosphor-icons/react";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { CaretUpIcon } from "@phosphor-icons/react/CaretUp";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { GearSixIcon } from "@phosphor-icons/react/GearSix";
import { ImageIcon } from "@phosphor-icons/react/Image";
import { InfoIcon } from "@phosphor-icons/react/Info";
import { ListChecksIcon } from "@phosphor-icons/react/ListChecks";
import { ScrollIcon } from "@phosphor-icons/react/Scroll";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { XIcon } from "@phosphor-icons/react/X";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";

const ITEM_ICONS: Record<FeedbackItem["kind"], Icon> = {
  about: InfoIcon,
  chat: ChatCircleIcon,
  errors: WarningCircleIcon,
  log: ScrollIcon,
  settings: GearSixIcon,
  task: ListChecksIcon,
};

/**
 * One size for every step (the form, a file being read, the thanks), so
 * moving between them, opening a part or loading what goes never resizes
 * the dialog. The window caps it where it is smaller.
 */
const DIALOG_SIZE = { height: "36rem", width: "35rem" };

type Part = {
  id: string;
  items: FeedbackItem[];
  sub: string;
  title: string;
};

/** An image the person attached: a picked, pasted or dropped file. */
type AttachedImage = {
  file: Blob;
  id: string;
  name: string;
  size: number;
  /** A data URL, so a picture shown needs nothing released when it goes. */
  src: string;
};

function readDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("The image couldn't be read"));
    });
    reader.readAsDataURL(file);
  });
}

/**
 * The files offered that can be attached after `already` images, each with
 * an id and its picture, and a line for each one left out.
 */
async function offerImages(already: number, files: readonly File[]) {
  const candidates = await Promise.all(
    files.map(async (file) => ({
      file,
      head: new Uint8Array(await file.slice(0, IMAGE_HEAD_BYTES).arrayBuffer()),
      id: crypto.randomUUID(),
      name: file.name || "Pasted image",
      size: file.size,
    })),
  );
  const { accepted, problems } = checkFeedbackImages(already, candidates);
  return {
    accepted: await Promise.all(
      accepted.map(
        async ({ file, id, name, size }): Promise<AttachedImage> => ({
          file,
          id,
          name,
          size,
          src: await readDataUrl(file),
        }),
      ),
    ),
    problems,
  };
}

/**
 * Feedback: the person's comments and the images they attach, then what
 * goes with them in parts (the images, the chat, when there is one, and the
 * diagnostics), each a box over its files that opens to list them, every
 * file with its own box and a way to read it as it will be sent. Everything
 * starts checked.
 */
export function FeedbackDialogContent({
  onClose,
  onExitComplete,
  request,
}: {
  onClose: () => void;
  onExitComplete: () => void;
  request: FeedbackRequest;
}) {
  const noteId = useId();
  const [note, setNote] = useState("");
  const [leftOut, setLeftOut] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [viewing, setViewing] = useState<AttachedImage | FeedbackItem | null>(
    null,
  );
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [imageProblems, setImageProblems] = useState<string[]>([]);
  const pickerRef = useRef<HTMLInputElement>(null);

  const addImages = async (files: readonly File[]) => {
    if (files.length === 0) {
      return;
    }
    const { accepted, problems } = await offerImages(images.length, files);
    setImages((current) => [...current, ...accepted]);
    setImageProblems(problems);
  };

  // Read once per opening: what the dialog shows is what Send sends.
  const described = useQuery({
    ...rpcClient.problems.describeFeedback.queryOptions({
      input: { chatId: request.chatId },
    }),
    gcTime: 0,
    staleTime: Infinity,
  });

  const parts: Part[] = described.data
    ? [
        ...(described.data.chat
          ? [
              {
                id: "chat",
                items: described.data.chat.items,
                sub: chatSubline(described.data.chat.taskCount),
                title: "This chat",
              },
            ]
          : []),
        {
          id: "diagnostics",
          items: described.data.diagnostics.items,
          sub: "Version numbers, recent errors and the app's log",
          title: "Diagnostics",
        },
      ]
    : [];
  const going = parts
    .flatMap((part) => part.items)
    .filter((item) => !leftOut.has(item.id));
  const chatTooLarge =
    bytesGoing(described.data?.chat?.items ?? [], leftOut) > MAX_REPORT_BYTES;

  const send = useMutation({
    mutationFn: () => {
      const trimmed = note.trim();
      return rpcClient.problems.sendFeedback.call({
        images: images.map((image) => ({ data: image.file, name: image.name })),
        items: going,
        note: trimmed || undefined,
        surface: request.surface,
        title:
          trimmed.split("\n")[0]?.slice(0, 300) ||
          (request.chatId ? "Feedback about a chat" : "Feedback"),
      });
    },
    onSuccess: () => {
      request.onSent?.();
    },
  });

  useEffect(() => {
    if (!send.isSuccess) {
      return;
    }
    const timeout = setTimeout(onClose, SENT_CLOSE_MS);
    return () => {
      clearTimeout(timeout);
    };
  }, [onClose, send.isSuccess]);

  if (send.isSuccess) {
    return (
      <DialogContent
        className="flex flex-col items-center justify-center"
        maxHeight={DIALOG_SIZE.height}
        maxWidth={DIALOG_SIZE.width}
        onExitComplete={onExitComplete}
        style={{ height: DIALOG_SIZE.height }}
      >
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircleIcon className="size-7 text-brand-600" />
          <DialogTitle>Thanks, we got your feedback.</DialogTitle>
          <DialogDescription className="sr-only">
            The feedback was sent.
          </DialogDescription>
        </div>
      </DialogContent>
    );
  }

  if (viewing) {
    return (
      <DialogContent
        className="flex flex-col gap-0 p-0"
        maxHeight={DIALOG_SIZE.height}
        maxWidth={DIALOG_SIZE.width}
        onEscapeKeyDown={(event) => {
          // Escape goes back to the list, as the arrow does.
          event.preventDefault();
          setViewing(null);
        }}
        onExitComplete={onExitComplete}
        showCloseButton={false}
        style={{ height: DIALOG_SIZE.height }}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Button
            aria-label="Back"
            onClick={() => {
              setViewing(null);
            }}
            size="icon-sm"
            variant="ghost"
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
          <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium">
            {"files" in viewing ? viewing.label : viewing.name}
          </DialogTitle>
          <DialogDescription className="shrink-0 text-xs text-muted-foreground">
            {"files" in viewing
              ? `${formatSize(viewing.bytes)} · read only`
              : formatSize(viewing.size)}
          </DialogDescription>
        </div>
        {"files" in viewing ? (
          <pre className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[11px] leading-[17px] wrap-anywhere whitespace-pre-wrap text-foreground/80 select-text">
            {itemText(viewing)}
          </pre>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/40 p-4">
            <img
              alt={viewing.name}
              className="max-h-full max-w-full object-contain"
              src={viewing.src}
            />
          </div>
        )}
        <div className="flex justify-end border-t border-border px-4 py-3">
          <Button
            onClick={() => {
              setViewing(null);
            }}
            variant="outline"
          >
            Done
          </Button>
        </div>
      </DialogContent>
    );
  }

  const problem = chatTooLarge
    ? FEEDBACK_TOO_LARGE
    : send.error
      ? send.error.message
      : described.error
        ? `We couldn't gather what goes with your feedback: ${described.error.message}`
        : undefined;

  return (
    <DialogContent
      className="flex flex-col overflow-hidden"
      maxHeight={DIALOG_SIZE.height}
      maxWidth={DIALOG_SIZE.width}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          void addImages([...event.dataTransfer.files]);
        }
      }}
      onExitComplete={onExitComplete}
      onPaste={(event) => {
        const text = event.clipboardData.getData("text/plain");
        const files = [...event.clipboardData.items]
          .filter((item) =>
            shouldAttachClipboardItem({
              hasText: text.trim().length > 0,
              item,
            }),
          )
          .flatMap((item) => item.getAsFile() ?? []);
        if (files.length > 0) {
          event.preventDefault();
          void addImages(files);
        }
      }}
      showCloseButton={false}
      style={{ height: DIALOG_SIZE.height }}
    >
      <div className="flex flex-col gap-1">
        <DialogTitle>Send feedback</DialogTitle>
        <DialogDescription>
          Only the {APP_NAME} team will see what you send.
        </DialogDescription>
      </div>

      <div className="flex shrink-0 flex-col gap-1.5">
        <label className="text-xs font-medium" htmlFor={noteId}>
          Comments
        </label>
        <Textarea
          autoFocus
          className="max-h-40"
          id={noteId}
          maxLength={5000}
          onChange={(event) => {
            setNote(event.target.value);
          }}
          placeholder="What happened, and what did you expect?"
          value={note}
        />
      </div>

      <div className="flex shrink-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {images.map((image) => (
            <div className="relative" key={image.id}>
              <button
                aria-label={`View ${image.name}`}
                className="block size-14 overflow-hidden rounded-md border border-border bg-muted"
                onClick={() => {
                  setViewing(image);
                }}
                type="button"
              >
                <img
                  alt=""
                  className="size-full object-cover"
                  src={image.src}
                />
              </button>
              <button
                aria-label={`Remove ${image.name}`}
                className="absolute -top-1.5 -right-1.5 grid size-4.5 place-items-center rounded-full bg-foreground text-background hover:bg-foreground/80"
                onClick={() => {
                  setImages((current) =>
                    current.filter((other) => other.id !== image.id),
                  );
                  setImageProblems([]);
                }}
                type="button"
              >
                <XIcon className="size-2.5" weight="bold" />
              </button>
            </div>
          ))}
          <Button
            disabled={images.length >= MAX_FEEDBACK_IMAGES}
            onClick={() => {
              pickerRef.current?.click();
            }}
            size="sm"
            variant="outline"
          >
            <ImageIcon />
            Add images
          </Button>
          <input
            accept={FEEDBACK_IMAGE_TYPES.join(",")}
            className="hidden"
            multiple
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              void addImages(files);
            }}
            ref={pickerRef}
            type="file"
          />
        </div>
        {imageProblems.map((line) => (
          <p
            className="flex items-start gap-1.5 text-xs text-destructive"
            key={line}
          >
            <WarningCircleIcon className="mt-px size-3.5 shrink-0" />
            {line}
          </p>
        ))}
      </div>

      {/* What goes takes the room left, and scrolls in it. */}
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {images.length > 0 && (
          <ImagesPart images={images} onView={setViewing} />
        )}
        {described.isPending && (
          <p className="text-sm text-muted-foreground">
            Gathering the details…
          </p>
        )}
        {parts.length > 0 && (
          <div className="flex flex-col gap-2">
            {parts.map((part) => (
              <FeedbackPart
                key={part.id}
                leftOut={leftOut}
                onLeftOut={setLeftOut}
                onToggleOpen={() => {
                  setOpened((current) => toggleItem(part.id, current));
                }}
                onView={setViewing}
                open={opened.has(part.id)}
                part={part}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          {problem && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <WarningCircleIcon className="mt-px size-3.5 shrink-0" />
              {problem}
            </p>
          )}
        </div>
        <Button onClick={onClose} variant="outline">
          Cancel
        </Button>
        <Button
          disabled={
            described.isPending ||
            chatTooLarge ||
            send.isPending ||
            (going.length === 0 && images.length === 0 && note.trim() === "")
          }
          onClick={() => {
            send.mutate();
          }}
          variant="brand"
        >
          {send.isPending ? (
            <>
              <Spinner className="size-3.5" />
              Sending…
            </>
          ) : send.isError ? (
            "Try again"
          ) : (
            "Send"
          )}
        </Button>
      </div>
    </DialogContent>
  );
}

/**
 * The images attached, as the first part of what goes. Each goes as it is
 * while it is attached, so the part has no boxes; the × on its picture
 * takes one out.
 */
function ImagesPart({
  images,
  onView,
}: {
  images: readonly AttachedImage[];
  onView: (image: AttachedImage) => void;
}) {
  return (
    <div className="mb-2 rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">
            {images.length === 1 ? "Image" : `${images.length} images`}
          </span>
          <span className="text-xs text-muted-foreground">
            {images.length === 1
              ? "The picture you attached"
              : "The pictures you attached"}
          </span>
        </span>
        <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">
          {formatSize(images.reduce((sum, image) => sum + image.size, 0))}
        </span>
      </div>
      <div className="mt-1 ml-0.5 flex flex-col border-l border-border pl-2">
        {images.map((image) => (
          <button
            aria-label={`View ${image.name}`}
            className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1 text-left text-[13px] hover:bg-accent"
            key={image.id}
            onClick={() => {
              onView(image);
            }}
            type="button"
          >
            <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{image.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatSize(image.size)}
            </span>
            <CaretRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}

/** One part of what goes: its box, what it is, its size, and the caret that opens its files. */
function FeedbackPart({
  leftOut,
  onLeftOut,
  onToggleOpen,
  onView,
  open,
  part,
}: {
  leftOut: ReadonlySet<string>;
  onLeftOut: (next: ReadonlySet<string>) => void;
  onToggleOpen: () => void;
  onView: (item: FeedbackItem) => void;
  open: boolean;
  part: Part;
}) {
  const ids = part.items.map((item) => item.id);
  const state = partState(ids, leftOut);
  const Caret = open ? CaretUpIcon : CaretDownIcon;
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <Checkbox
          aria-label={part.title}
          checked={state}
          className="mt-0.5"
          onCheckedChange={() => {
            onLeftOut(togglePart(ids, leftOut));
          }}
        />
        <button
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          onClick={onToggleOpen}
          type="button"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm">{part.title}</span>
            <span className="text-xs text-muted-foreground">{part.sub}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2 pt-0.5 text-xs text-muted-foreground">
            {state === false
              ? "Not included"
              : formatSize(bytesGoing(part.items, leftOut))}
            <Caret className="size-3.5" />
          </span>
        </button>
      </div>
      {open && (
        <div className="mt-1 ml-6 flex flex-col border-l border-border pl-2">
          {part.items.map((item) => {
            const ItemIcon = ITEM_ICONS[item.kind];
            const included = !leftOut.has(item.id);
            return (
              <div
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2 py-0.5 text-[13px]",
                  !included && "text-muted-foreground",
                )}
                key={item.id}
              >
                <Checkbox
                  aria-label={item.label}
                  checked={included}
                  onCheckedChange={() => {
                    onLeftOut(toggleItem(item.id, leftOut));
                  }}
                />
                <button
                  aria-label={`Read ${item.label}`}
                  className="-mr-2 flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-1 pr-2 text-left hover:bg-accent"
                  onClick={() => {
                    onView(item);
                  }}
                  type="button"
                >
                  <ItemIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatSize(item.bytes)}
                  </span>
                  <CaretRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function chatSubline(taskCount: number) {
  if (taskCount === 0) {
    return "The chat, including the files it read";
  }
  return taskCount === 1
    ? "The chat and its task, including the files they read"
    : `The chat and its ${taskCount} tasks, including the files they read`;
}

/** An item as it is sent: its file, each of its files under its name, or its errors as JSON. */
function itemText(item: FeedbackItem) {
  const files = item.files.map((file) =>
    item.files.length === 1 ? file.content : `${file.path}\n\n${file.content}`,
  );
  const events =
    item.events && item.events.length > 0
      ? [JSON.stringify(item.events, null, 2)]
      : [];
  return [...files, ...events].join("\n\n");
}
