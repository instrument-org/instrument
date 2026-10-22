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
import { SENT_CLOSE_MS } from "@/client/lib/problem-reports";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
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
import { InfoIcon } from "@phosphor-icons/react/Info";
import { ListChecksIcon } from "@phosphor-icons/react/ListChecks";
import { ScrollIcon } from "@phosphor-icons/react/Scroll";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";

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

/**
 * Feedback: the person's comments, then what goes with them in parts (the
 * chat, when there is one, and the diagnostics), each a box over its files
 * that opens to list them, every file with its own box and a way to read it
 * as it will be sent. Everything starts checked.
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
  const [viewing, setViewing] = useState<FeedbackItem | null>(null);

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
            {viewing.label}
          </DialogTitle>
          <DialogDescription className="shrink-0 text-xs text-muted-foreground">
            {formatSize(viewing.bytes)} · read only
          </DialogDescription>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[11px] leading-[17px] wrap-anywhere whitespace-pre-wrap text-foreground/80 select-text">
          {itemText(viewing)}
        </pre>
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
      onExitComplete={onExitComplete}
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
            (going.length === 0 && note.trim() === "")
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
