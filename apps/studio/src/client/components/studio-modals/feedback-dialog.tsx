import { type FeedbackRequest } from "@/client/atoms/report-dialog";
import { Button } from "@/client/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Switch } from "@/client/components/ui/switch";
import {
  DictatedTextarea,
  useDictatedText,
} from "@/client/components/dictation-controls";
import { FileTypeIcon } from "@/client/components/extend/file-system";
import { isDictating } from "@/client/hooks/use-dictation";
import { useModalBack } from "@/client/hooks/use-modal-back";
import { type ActionMark, actionRows } from "@/client/lib/feedback-actions";
import {
  aboutFields,
  chatGroups,
  eventFields,
  type GroupItem,
  REDACTION,
  type RecordField,
  type RecordGroup,
  type RecordRow,
} from "@/client/lib/feedback-records";
import { shouldAttachClipboardItem } from "@/client/lib/paste-clipboard";
import { toast } from "@/client/lib/toast";
import { cn, osConventions } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  checkFeedbackImages,
  FEEDBACK_IMAGE_TYPES,
  IMAGE_HEAD_BYTES,
  MAX_FEEDBACK_IMAGES,
} from "@/shared/feedback-images";
import {
  FEEDBACK_ACTIONS_MS,
  FEEDBACK_TOO_LARGE,
  type FeedbackItem,
  type FeedbackTag,
  MAX_REPORT_BYTES,
} from "@/shared/problem-reports";
import { APP_NAME } from "@instrument-org/shared";
import { type ExceptionEvent } from "@instrument-org/shared/exceptions";
import { AppWindowIcon } from "@phosphor-icons/react/AppWindow";
import { ArrowBendDownRightIcon } from "@phosphor-icons/react/ArrowBendDownRight";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { FolderIcon } from "@phosphor-icons/react/Folder";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { ImageIcon } from "@phosphor-icons/react/Image";
import { PlugsIcon } from "@phosphor-icons/react/Plugs";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode, useRef, useState } from "react";

/** The agent's write-up as one file of what goes, sent like the rest. */
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

/** One short column; what goes is read on a page of its own at this height. */
const DIALOG_WIDTH = "38rem";
const REVIEW_HEIGHT = "40rem";

const NOTE_MAX_LENGTH = 5000;

/** The tags as the dialog offers them, with the question each one's note answers. */
const TAGS: readonly {
  label: string;
  placeholder?: string;
  tag: FeedbackTag;
}[] = [
  { label: "Good result", placeholder: "What worked well?", tag: "good" },
  {
    label: "Okay result",
    placeholder: "What could have gone better?",
    tag: "okay",
  },
  { label: "Bad result", placeholder: "What went wrong?", tag: "bad" },
  { label: "Bug", tag: "bug" },
  { label: "Too slow", placeholder: "What took too long?", tag: "slow" },
  { label: "Idea", placeholder: "What's your idea?", tag: "idea" },
  { label: "Other", tag: "other" },
];

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

/** A part of what goes, as the dialog lists it and its review page shows it. */
type Part = {
  item: FeedbackItem;
  line: string;
  /** Whether it goes, for the one part the person may leave out. */
  sending?: { on: boolean; set: (on: boolean) => void };
  title: string;
};

/**
 * Feedback: the person's note and the images they attach, then what goes
 * with them, a row each (the agent's write-up, the chat when there is one,
 * what the person did in the app, and the diagnostics). View turns the
 * dialog into a page that shows each as it will be sent, a row per record.
 * Everything listed goes, but what the person did in the app has a switch
 * to leave it out.
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
  const [note, setNote] = useState("");
  const [tag, setTag] = useState(request.tag);
  const noteDictation = useDictatedText({
    maxLength: NOTE_MAX_LENGTH,
    onChange: setNote,
    surface: "report",
    value: note,
  });
  const [viewing, setViewing] = useState<string | null>(null);
  const [sendActions, setSendActions] = useState(true);
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [imageProblems, setImageProblems] = useState<string[]>([]);
  const pickerRef = useRef<HTMLInputElement>(null);
  const { thisComputer } = osConventions();
  const yourComputer = thisComputer.replace(/^this /, "your ");

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

  const chat = described.data?.chat;
  const chatTooLarge = chat ? chat.item.bytes > MAX_REPORT_BYTES : false;
  const parts: Part[] = [
    ...(request.writeup
      ? [
          {
            item: writeupItem(request.writeup),
            line: request.writeup.title,
            title: `${APP_NAME}'s write-up`,
          },
        ]
      : []),
    ...(chat
      ? [
          {
            item: chat.item,
            line: chatTooLarge
              ? FEEDBACK_TOO_LARGE
              : `Your messages, ${APP_NAME}'s replies and each step it took. What it read stays on ${yourComputer}.`,
            title: chat.title,
          },
        ]
      : []),
    ...(described.data?.actions
      ? [
          {
            item: described.data.actions,
            line: sendActions
              ? `What you opened and changed in ${APP_NAME} in the ${FEEDBACK_ACTIONS_MS / 60_000} minutes before this.`
              : `This stays on ${yourComputer}.`,
            sending: { on: sendActions, set: setSendActions },
            title: "What you did in the app",
          },
        ]
      : []),
    ...(described.data
      ? [
          {
            item: described.data.diagnostics,
            line: `${APP_NAME}'s version, ${yourComputer} and recent errors.`,
            title: "Diagnostics",
          },
        ]
      : []),
  ];
  const going = parts
    .filter((part) => part.sending?.on !== false)
    .map((part) => part.item);
  const reviewed = parts.find((part) => part.item.id === viewing);

  // The dialog gets out of the way at once, and the toast follows the send.
  const send = () => {
    const trimmed = note.trim();
    const feedback = {
      images: images.map((image) => ({ data: image.file, name: image.name })),
      items: going,
      note: trimmed || undefined,
      surface: request.surface,
      tag,
      title:
        trimmed.split("\n")[0]?.slice(0, 300) ||
        request.writeup?.title ||
        (request.chatId ? "Feedback about a chat" : "Feedback"),
    };
    onClose();
    toast.work({
      done: "Thanks, we got your feedback.",
      failed: "Couldn't send your feedback",
      onDone: request.onSent,
      run: async () => {
        await rpcClient.problems.sendFeedback.call(feedback);
      },
      running: "Sending your feedback…",
    });
  };

  // Back (a thumb button, a swipe, the History menu) leaves the review for
  // the form, as it leaves a page inside Settings.
  useModalBack(() => {
    setViewing(null);
  }, reviewed !== undefined);

  const problem = described.error
    ? `We couldn't gather what goes with your feedback: ${described.error.message}`
    : undefined;

  const sendButton = (
    <Button
      disabled={
        described.isPending ||
        chatTooLarge ||
        // Waits for dictated words, so the note goes with them.
        isDictating(noteDictation.phase)
      }
      onClick={send}
      variant="brand"
    >
      Send
    </Button>
  );

  // One `DialogContent` for the form and the review, so moving
  // between them swaps what is inside rather than opening the dialog again.
  return (
    <DialogContent
      className="flex flex-col gap-0 overflow-hidden p-0"
      maxHeight={REVIEW_HEIGHT}
      maxWidth={DIALOG_WIDTH}
      onDragOver={(event) => {
        if (reviewed) {
          return;
        }
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        if (reviewed) {
          return;
        }
        if (event.dataTransfer.files.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          void addImages([...event.dataTransfer.files]);
        }
      }}
      // Escape on the review goes back to the form rather than closing.
      onEscapeKeyDown={(event) => {
        if (reviewed) {
          event.preventDefault();
          setViewing(null);
        }
      }}
      onExitComplete={onExitComplete}
      onPaste={(event) => {
        if (reviewed) {
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
      showCloseButton={!reviewed}
      style={reviewed ? { height: REVIEW_HEIGHT } : undefined}
    >
      {reviewed ? (
        <Review
          onBack={() => {
            setViewing(null);
          }}
          part={reviewed}
          readAt={described.dataUpdatedAt}
        />
      ) : (
        <div className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-2 pr-6">
            <DialogTitle>Send feedback</DialogTitle>
            <DialogDescription>
              Only the {APP_NAME} team will see what you send, and you can look
              it over first.
            </DialogDescription>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-medium text-muted-foreground">
              What's it about?
            </p>
            <div className="flex flex-wrap gap-2">
              {TAGS.map((each) => (
                <button
                  aria-pressed={tag === each.tag}
                  className={cn(
                    "inline-flex h-7 items-center rounded-full px-3 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    tag === each.tag
                      ? "bg-brand-600 text-white"
                      : "border border-border bg-card text-foreground/80 hover:bg-accent",
                  )}
                  key={each.tag}
                  onClick={() => {
                    setTag(tag === each.tag ? undefined : each.tag);
                  }}
                  type="button"
                >
                  {each.label}
                </button>
              ))}
            </div>
          </div>

          <DictatedTextarea
            aria-label="Your note"
            autoFocus
            className="min-h-24"
            dictation={noteDictation}
            maxLength={NOTE_MAX_LENGTH}
            onChange={(event) => {
              setNote(event.target.value);
            }}
            placeholder={
              request.writeup
                ? "Anything to add? You can also send it as it is."
                : (TAGS.find((each) => each.tag === tag)?.placeholder ??
                  "What happened, and what did you expect?")
            }
            value={note}
          />

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              {images.map((image) => (
                <div className="relative" key={image.id}>
                  <img
                    alt={image.name}
                    className="block size-14 rounded-md border border-border bg-muted object-cover"
                    src={image.src}
                  />
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

          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-medium text-muted-foreground">
              Sent with your note
            </p>
            <div className="divide-y divide-border rounded-xl border border-border">
              {described.isPending
                ? (request.chatId
                    ? ["chat", "diagnostics"]
                    : ["diagnostics"]
                  ).map((id) => <PartRowLoading key={id} />)
                : parts.map((part) => (
                    <PartRow
                      key={part.item.id}
                      onView={() => {
                        setViewing(part.item.id);
                      }}
                      part={part}
                    />
                  ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
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
            {sendButton}
          </div>
        </div>
      )}
    </DialogContent>
  );
}

/** A part of what goes: its name, the line saying what it is, its switch when it has one, and View. */
function PartRow({ onView, part }: { onView: () => void; part: Part }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{part.title}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{part.line}</p>
      </div>
      {part.sending && (
        <Switch
          aria-label={`Send ${part.title.toLowerCase()}`}
          checked={part.sending.on}
          onCheckedChange={part.sending.set}
        />
      )}
      <Button
        aria-label={`View ${part.title}`}
        onClick={onView}
        size="sm"
        variant="outline"
      >
        View
      </Button>
    </div>
  );
}

function PartRowLoading() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-3 w-64" />
      </div>
      <Button disabled size="sm" variant="outline">
        View
      </Button>
    </div>
  );
}

/** The review page: one part as it will be sent, under its own name. */
function Review({
  onBack,
  part,
  readAt,
}: {
  onBack: () => void;
  part: Part;
  /** When what goes was read, which what the person did is read back from. */
  readAt: number;
}) {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <Button
          aria-label="Back"
          onClick={onBack}
          size="icon-sm"
          variant="ghost"
        >
          <ArrowLeftIcon />
        </Button>
        <DialogTitle className="min-w-0 flex-1 truncate text-[15px]">
          {part.title}
        </DialogTitle>
        <DialogDescription className="sr-only">{part.line}</DialogDescription>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {part.item.kind === "chat" ? (
          <ChatReview item={part.item} />
        ) : part.item.kind === "actions" ? (
          <ActionsReview item={part.item} readAt={readAt} />
        ) : part.item.kind === "diagnostics" ? (
          <DiagnosticsReview item={part.item} />
        ) : (
          <p className="px-3 py-2 text-sm whitespace-pre-wrap">
            {part.item.files[0]?.content}
          </p>
        )}
      </div>
      <div className="flex h-14 shrink-0 items-center gap-3 border-t border-border px-5">
        <div className="min-w-0 flex-1">
          {part.sending && (
            <label className="inline-flex items-center gap-2.5 text-sm">
              <Switch
                checked={part.sending.on}
                onCheckedChange={part.sending.set}
              />
              Send with your feedback
            </label>
          )}
        </div>
        <Button onClick={onBack} variant="outline">
          Done
        </Button>
      </div>
    </>
  );
}

/** The mark beside one thing the person did. */
function ActionMarkIcon({ mark }: { mark: ActionMark }) {
  const className = "size-4 text-foreground/70";
  switch (mark.kind) {
    case "app": {
      return <PlugsIcon className={className} />;
    }
    case "chat": {
      return <ChatCircleIcon className={className} />;
    }
    case "error": {
      return <WarningCircleIcon className="size-4 text-destructive" />;
    }
    case "file": {
      return <FileTypeIcon className="size-4" fileName={mark.file} />;
    }
    case "folder": {
      return <FolderIcon className={className} />;
    }
    case "move": {
      return <ArrowBendDownRightIcon className={className} />;
    }
    case "page": {
      return <GlobeIcon className={className} />;
    }
    case "screen": {
      return <AppWindowIcon className={className} />;
    }
  }
}

/** What the person did in the app, oldest first, a plain sentence each, as it will be sent. */
function ActionsReview({
  item,
  readAt,
}: {
  item: FeedbackItem;
  readAt: number;
}) {
  const rows = actionRows(item.files[0]?.content ?? "", {
    trash: osConventions().trash,
  });
  return (
    <div className="flex flex-col">
      <p className="px-3 pt-1 pb-2 text-[13px] text-muted-foreground">
        From {timeOfDay(readAt - FEEDBACK_ACTIONS_MS)} to {timeOfDay(readAt)},
        written just as it will be sent.
      </p>
      {rows.map((row, index) => (
        <div
          className="flex items-start gap-3 rounded-md px-3 py-1.5 select-text"
          // oxlint-disable-next-line react/no-array-index-key -- a file's records never move
          key={index}
        >
          <span className="w-16 shrink-0 pt-px text-[13px] text-muted-foreground tabular-nums">
            {timeOfDay(Date.parse(row.at))}
          </span>
          <span className="grid size-5 shrink-0 place-items-center">
            <ActionMarkIcon mark={row.mark} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-5 break-words">{row.what}</p>
            {row.where && (
              <p className="truncate text-[13px] leading-5 text-muted-foreground">
                {row.where}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChatReview({ item }: { item: FeedbackItem }) {
  const groups = chatGroups(item.files);
  return (
    <div className="flex flex-col gap-1">
      {groups.map((group) => (
        <Group group={group} key={group.title} />
      ))}
    </div>
  );
}

/** A session or the chat's settings under its name, which opens and closes it. */
function Group({ group }: { group: RecordGroup }) {
  const [open, setOpen] = useState(group.open);
  const Caret = open ? CaretDownIcon : CaretRightIcon;
  return (
    <div>
      <button
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-3 pt-3 pb-1 text-left"
        onClick={() => {
          setOpen(!open);
        }}
        type="button"
      >
        <span className="min-w-0 truncate text-[13px] font-medium">
          {group.title}
        </span>
        <Caret className="size-3 shrink-0 text-muted-foreground/70" />
      </button>
      {open && (
        <div className="divide-y divide-border/60">
          {group.items.map((item, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- a file's records never move
            <Item item={item} key={index} />
          ))}
        </div>
      )}
    </div>
  );
}

function Item({ item }: { item: GroupItem }) {
  return "row" in item ? (
    <RecordLine row={item.row} />
  ) : (
    <StepsLine steps={item.steps} />
  );
}

/** The steps between two things said, as one line that opens onto each of them. */
function StepsLine({ steps }: { steps: readonly RecordRow[] }) {
  const [open, setOpen] = useState(false);
  const failed = steps.filter((step) => step.failed).length;
  const Caret = open ? CaretDownIcon : CaretRightIcon;
  return (
    <div>
      <button
        aria-expanded={open}
        className="flex h-8 w-full min-w-0 items-center gap-3 rounded-md px-3 text-left text-[13px] text-muted-foreground hover:bg-accent"
        onClick={() => {
          setOpen(!open);
        }}
        type="button"
      >
        <span className="w-20 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {steps.length === 1 ? "1 step" : `${steps.length} steps`}
          {failed > 0 && (
            <span className="text-destructive">
              {" "}
              · {failed === 1 ? "1 failed" : `${failed} failed`}
            </span>
          )}
        </span>
        <Caret className="size-3 shrink-0 text-muted-foreground/70" />
      </button>
      {open && (
        <div className="rounded-md bg-muted/40">
          {steps.map((step, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- a file's records never move
            <RecordLine key={index} row={step} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One record: its label and its first line, opening onto its fields. */
function RecordLine({ row }: { row: RecordRow }) {
  const [open, setOpen] = useState(false);
  const Caret = open ? CaretDownIcon : CaretRightIcon;
  return (
    <div>
      <button
        aria-expanded={open}
        className={cn(
          "flex h-8 w-full min-w-0 items-center gap-3 rounded-md px-3 text-left text-[13px] hover:bg-accent",
          open && "bg-accent",
        )}
        onClick={() => {
          setOpen(!open);
        }}
        type="button"
      >
        <span
          className={cn(
            "w-20 shrink-0 truncate text-xs",
            row.failed ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {row.label}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            row.mono && "font-mono text-xs",
            row.failed && "text-destructive",
          )}
        >
          {row.text}
        </span>
        <Caret className="size-3 shrink-0 text-muted-foreground/70" />
      </button>
      {open && <FieldList fields={row.fields} />}
    </div>
  );
}

function Redacted() {
  return (
    <span className="rounded bg-muted px-1.5 font-sans text-[11px] leading-[18px] text-muted-foreground">
      Redacted
    </span>
  );
}

/** A record's fields by name, with what goes for each. */
function FieldList({ fields }: { fields: readonly RecordField[] }) {
  return (
    <div className="mx-3 mb-1 rounded-b-md border-x border-b border-border bg-background px-3 py-2 select-text">
      {fields.length === 0 && (
        <p className="text-xs text-muted-foreground">Nothing else.</p>
      )}
      {fields.map((field) => (
        <div className="flex gap-3 py-0.5 text-xs" key={field.name}>
          <span className="w-28 shrink-0 break-words text-muted-foreground">
            {field.name}
          </span>
          <span className="min-w-0 flex-1 font-mono break-words whitespace-pre-wrap">
            {field.redacted && !field.value ? (
              <Redacted />
            ) : (
              field.value.split(REDACTION).map((piece, index) => (
                // oxlint-disable-next-line react/no-array-index-key -- a value's pieces never move
                <Fragment key={index}>
                  {index > 0 && <Redacted />}
                  {piece}
                </Fragment>
              ))
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The time of day an error last happened, in the person's own clock. */
function timeOfDay(at: number) {
  return new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function errorLine(event: ExceptionEvent) {
  const [first] = event.exceptions;
  return first ? `${first.type}: ${first.value}` : event.fingerprint;
}

function DiagnosticsReview({ item }: { item: FeedbackItem }) {
  const about = item.files.find((file) => file.path.endsWith(".json"));
  const log = item.files.find((file) => file.path.endsWith(".log"));
  const events = item.events ?? [];
  return (
    <div className="flex flex-col gap-5 px-3 py-2">
      {about && (
        <Section title={about.label ?? "About"}>
          <div className="divide-y divide-border rounded-xl border border-border">
            {aboutFields(about.content).map((field) => (
              <div
                className="flex justify-between gap-4 px-4 py-2 text-sm"
                key={field.name}
              >
                <span className="text-muted-foreground">{field.name}</span>
                <span className="min-w-0 truncate">{field.value}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {events.length > 0 && (
        <Section title="Recent errors">
          <div className="divide-y divide-border rounded-xl border border-border">
            {events.map((event) => (
              <ErrorLine event={event} key={event.id} />
            ))}
          </div>
        </Section>
      )}
      {log && (
        <Section title={log.label ?? "App log"}>
          <LogLine content={log.content} />
        </Section>
      )}
    </div>
  );
}

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function ErrorLine({ event }: { event: ExceptionEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        aria-expanded={open}
        className="flex w-full min-w-0 gap-3 px-4 py-2 text-left text-[13px] hover:bg-accent/60"
        onClick={() => {
          setOpen(!open);
        }}
        type="button"
      >
        <span className="w-16 shrink-0 text-muted-foreground tabular-nums">
          {timeOfDay(event.lastAt)}
        </span>
        <span className="min-w-0 flex-1 truncate">{errorLine(event)}</span>
      </button>
      {open && <FieldList fields={eventFields(event)} />}
    </div>
  );
}

function LogLine({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const lines = content.split("\n").filter(Boolean).length;
  const Caret = open ? CaretDownIcon : CaretRightIcon;
  return (
    <div className="rounded-xl border border-border">
      <button
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm hover:bg-accent/60"
        onClick={() => {
          setOpen(!open);
        }}
        type="button"
      >
        <span className="flex-1">The last {lines.toLocaleString()} lines</span>
        <Caret className="size-3.5 text-muted-foreground" />
      </button>
      {open && (
        <pre className="max-h-72 overflow-auto border-t border-border px-4 py-3 font-mono text-[11px] leading-[17px] whitespace-pre-wrap select-text">
          {content}
        </pre>
      )}
    </div>
  );
}
