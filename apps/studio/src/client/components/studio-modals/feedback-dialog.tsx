import { type FeedbackRequest } from "@/client/atoms/report-dialog";
import {
  BlockToolbarButton,
  blockToolbarButtonClassName,
  CodeBlock,
  wrapLinesClassName,
} from "@/client/components/code-block";
import { CopyButton } from "@/client/components/copy-button";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Spinner } from "@/client/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import {
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  DictatedTextarea,
  useDictatedText,
} from "@/client/components/dictation-controls";
import { isDictating } from "@/client/hooks/use-dictation";
import {
  bytesGoing,
  formatSize,
  partState,
  toggleItem,
  togglePart,
} from "@/client/lib/feedback-selection";
import { type RecordRow, recordRows } from "@/client/lib/feedback-records";
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
import { ArrowElbowDownLeftIcon } from "@phosphor-icons/react/ArrowElbowDownLeft";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { ArrowsHorizontalIcon } from "@phosphor-icons/react/ArrowsHorizontal";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { CaretUpIcon } from "@phosphor-icons/react/CaretUp";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { GearSixIcon } from "@phosphor-icons/react/GearSix";
import { ImageIcon } from "@phosphor-icons/react/Image";
import { NoteIcon } from "@phosphor-icons/react/Note";
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
  writeup: NoteIcon,
};

/** The agent's write-up as one file of what goes, for the dialog to offer like the rest. */
function writeupItem(writeup: { text: string; title: string }): FeedbackItem {
  const content = `# ${writeup.title}\n\n${writeup.text}\n`;
  return {
    bytes: new TextEncoder().encode(content).byteLength,
    files: [{ content, path: "writeup.md" }],
    id: "writeup",
    kind: "writeup",
    label: "writeup.md",
  };
}

/**
 * One width for every step. The form grows with what it shows up to the
 * height, and a file being read takes the whole of it. The window caps both
 * where it is smaller.
 */
const DIALOG_WIDTH = "38rem";
const DIALOG_HEIGHT = "40rem";

const NOTE_MAX_LENGTH = 5000;

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
  const noteDictation = useDictatedText({
    maxLength: NOTE_MAX_LENGTH,
    onChange: setNote,
    surface: "report",
    value: note,
  });
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
        ...(request.writeup
          ? [
              {
                id: "writeup",
                items: [writeupItem(request.writeup)],
                sub: "Written by the agent in this chat",
                title: `${APP_NAME}'s write-up`,
              },
            ]
          : []),
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
          request.writeup?.title ||
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

  const problem = chatTooLarge
    ? FEEDBACK_TOO_LARGE
    : send.error
      ? send.error.message
      : described.error
        ? `We couldn't gather what goes with your feedback: ${described.error.message}`
        : undefined;

  // One `DialogContent` for every step, so moving between them swaps what is
  // inside rather than opening the dialog again with its entrance animation.
  return (
    <DialogContent
      className={cn(
        "flex flex-col overflow-hidden",
        viewing && "gap-0 p-0",
        send.isSuccess && "items-center justify-center",
      )}
      maxHeight={DIALOG_HEIGHT}
      maxWidth={DIALOG_WIDTH}
      onDragOver={(event) => {
        if (viewing || send.isSuccess) {
          return;
        }
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        if (viewing || send.isSuccess) {
          return;
        }
        if (event.dataTransfer.files.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          void addImages([...event.dataTransfer.files]);
        }
      }}
      onEscapeKeyDown={(event) => {
        // Escape goes back to the list, as the arrow does.
        if (viewing) {
          event.preventDefault();
          setViewing(null);
        }
      }}
      onExitComplete={onExitComplete}
      onPaste={(event) => {
        if (viewing || send.isSuccess) {
          return;
        }
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
      // Reading a file takes the full height, so a long one has room; the
      // form and the thanks are as tall as what they show.
      style={viewing ? { height: DIALOG_HEIGHT } : undefined}
    >
      {send.isSuccess ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <CheckCircleIcon className="size-7 text-brand-600" />
          <DialogTitle>Thanks, we got your feedback.</DialogTitle>
          <DialogDescription className="sr-only">
            The feedback was sent.
          </DialogDescription>
        </div>
      ) : viewing ? (
        <FileView
          onBack={() => {
            setViewing(null);
          }}
          viewing={viewing}
        />
      ) : (
        <>
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
            <DictatedTextarea
              autoFocus
              className="max-h-40"
              dictation={noteDictation}
              id={noteId}
              maxLength={NOTE_MAX_LENGTH}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              placeholder={
                request.writeup
                  ? "Anything to add? You can also send it as it is."
                  : "What happened, and what did you expect?"
              }
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
                // Waits for dictated words, so the comments go with them.
                isDictating(noteDictation.phase) ||
                (going.length === 0 &&
                  images.length === 0 &&
                  note.trim() === "")
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
        </>
      )}
    </DialogContent>
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

/** A block of the file view: what it shows, in which language, and what Copy copies. */
type ViewBlock = {
  code: string;
  copy: string;
  key: string;
  label?: string;
  language?: string;
  /** A JSON Lines file's lines, which the view can list one record a row. */
  records?: RecordRow[];
};

/**
 * An item as blocks to read: each of its files, named when there are more
 * than one, and its errors as JSON. A JSON Lines file shows each record
 * indented under the last; Copy takes the file as it is sent.
 */
function itemBlocks(item: FeedbackItem): ViewBlock[] {
  const files = item.files.map((file): ViewBlock => {
    const extension = file.path.split(".").pop()?.toLowerCase();
    const records =
      extension === "jsonl" ? recordRows(file.content) : undefined;
    return {
      code: records
        ? records.map((record) => record.json).join("\n\n")
        : file.content,
      copy: file.content,
      key: file.path,
      label: item.files.length > 1 ? file.path.split("/").pop() : undefined,
      language: records ? "json" : extension,
      records,
    };
  });
  if (!item.events || item.events.length === 0) {
    return files;
  }
  const events = JSON.stringify(item.events, null, 2);
  return [
    ...files,
    {
      code: events,
      copy: events,
      key: "events",
      label: files.length > 0 ? "Errors" : undefined,
      language: "json",
    },
  ];
}

/** A file or an image being read, with the arrow back to the list. */
function FileView({
  onBack,
  viewing,
}: {
  onBack: () => void;
  viewing: AttachedImage | FeedbackItem;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const blocks = "files" in viewing ? itemBlocks(viewing) : [];
  const hasRecords = blocks.some((block) => block.records);
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Button
          aria-label="Back"
          onClick={onBack}
          size="icon-sm"
          variant="ghost"
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium">
          {"files" in viewing ? viewing.label : viewing.name}
        </DialogTitle>
        {hasRecords && (
          <Tabs
            onValueChange={(value) => {
              setShowRaw(value === "raw");
            }}
            value={showRaw ? "raw" : "records"}
          >
            <TabsList className="h-7">
              <TabsTrigger className="px-2 text-xs" value="records">
                Records
              </TabsTrigger>
              <TabsTrigger className="px-2 text-xs" value="raw">
                Raw
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <DialogDescription className="shrink-0 text-xs text-muted-foreground">
          {formatSize("files" in viewing ? viewing.bytes : viewing.size)}
        </DialogDescription>
      </div>
      {"files" in viewing ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
          {blocks.map((block) =>
            block.records && !showRaw ? (
              <RecordsBlock
                block={block}
                key={block.key}
                records={block.records}
              />
            ) : (
              <FileBlock block={block} key={block.key} />
            ),
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/40 p-4">
          <img
            alt={viewing.name}
            className="max-h-full max-w-full object-contain"
            src={viewing.src}
          />
        </div>
      )}
    </>
  );
}

/**
 * A JSON Lines file a record a row: its `seq`, its time, its type and a
 * gist, each row opening to the record whole. Copy takes the file as it is
 * sent.
 */
function RecordsBlock({
  block,
  records,
}: {
  block: ViewBlock;
  records: readonly RecordRow[];
}) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  return (
    <div className="group/block-toolbar relative isolate rounded-lg bg-muted/50 py-1.5">
      <div className="sticky top-0 z-10 h-0">
        <div className="flex items-start justify-end p-1.5 opacity-0 group-hover/block-toolbar:opacity-100 focus-within:opacity-100">
          <CopyButton
            className={blockToolbarButtonClassName}
            iconSize={12}
            onCopy={async () => {
              await navigator.clipboard.writeText(block.copy);
            }}
            tooltip="Copy"
          />
        </div>
      </div>
      {block.label && (
        <p className="truncate px-3 pt-1 pb-1.5 text-xs text-muted-foreground">
          {block.label}
        </p>
      )}
      {records.map((record, index) => {
        const open = opened.has(String(index));
        return (
          // oxlint-disable-next-line react/no-array-index-key -- a file's lines never move
          <div key={index}>
            <button
              aria-expanded={open}
              className="flex w-full min-w-0 items-baseline gap-2.5 px-3 py-0.5 text-left font-mono text-[11px] leading-[17px] hover:bg-accent"
              onClick={() => {
                setOpened((current) => toggleItem(String(index), current));
              }}
              type="button"
            >
              <span className="w-7 shrink-0 text-right text-muted-foreground/70 tabular-nums">
                {record.seq ?? ""}
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {record.at?.slice(11, 19) ?? ""}
              </span>
              <span
                className={cn(
                  "shrink-0",
                  record.failed ? "text-destructive" : "text-foreground",
                )}
              >
                {record.kind}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {record.detail}
              </span>
            </button>
            {open && (
              <div
                className={cn(
                  "mx-3 my-1 rounded-md bg-background/60 font-mono text-[11px] leading-[17px] text-foreground/90 select-text [&_pre]:px-3 [&_pre]:py-2",
                  wrapLinesClassName,
                )}
              >
                <CodeBlock code={record.json} language="json" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One file as code, with the wrap and copy controls code blocks have
 * elsewhere. They stay at the top of the view while the block scrolls under
 * them, since a file here is usually taller than the dialog.
 */
function FileBlock({ block }: { block: ViewBlock }) {
  const [wrapLines, setWrapLines] = useState(true);
  return (
    <div className="group/block-toolbar relative isolate rounded-lg bg-muted/50">
      <div className="sticky top-0 z-10 h-0">
        <div className="flex items-start justify-end gap-1 p-1.5 opacity-0 group-hover/block-toolbar:opacity-100 focus-within:opacity-100">
          <BlockToolbarButton
            icon={wrapLines ? ArrowElbowDownLeftIcon : ArrowsHorizontalIcon}
            label="Wrap lines"
            onClick={() => {
              setWrapLines(!wrapLines);
            }}
            pressed={wrapLines}
          />
          <CopyButton
            className={blockToolbarButtonClassName}
            iconSize={12}
            onCopy={async () => {
              await navigator.clipboard.writeText(block.copy);
            }}
            tooltip="Copy"
          />
        </div>
      </div>
      {block.label && (
        <p className="truncate px-3 pt-2.5 text-xs text-muted-foreground">
          {block.label}
        </p>
      )}
      <div
        className={cn(
          "overflow-x-auto font-mono text-[11px] leading-[17px] text-foreground/90 select-text [&_pre]:px-3 [&_pre]:py-2.5",
          wrapLines && wrapLinesClassName,
        )}
      >
        <CodeBlock code={block.code} language={block.language} />
      </div>
    </div>
  );
}
