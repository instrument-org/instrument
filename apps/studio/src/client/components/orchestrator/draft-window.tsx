import {
  draftAtom,
  type DraftFile,
  draftPlacementAtom,
  EMPTY_DRAFT,
  THREADS_HREF,
} from "@/client/atoms/orchestrator";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCInput } from "@/client/rpc/client";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { type SessionMessageDataPart } from "@instrument-org/workspace/client";
import { ArrowsInSimpleIcon } from "@phosphor-icons/react/ArrowsInSimple";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { MinusIcon } from "@phosphor-icons/react/Minus";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { XIcon } from "@phosphor-icons/react/X";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { useOrchestrator } from "./context";
import { DraftComposer } from "./draft-composer";
import { fileHref } from "./file-tabs";
import { NewTopicDialog } from "./new-topic-dialog";

type Upload = NonNullable<
  RPCInput["workspace"]["message"]["create"]["files"]
>[number];

/**
 * The draft of a new thread, drawn where the draft's placement says: a
 * window at the bottom right of the app with a slim head carrying the ways
 * to shrink it to a bar, grow it into a modal, or put it away; a bar along
 * the bottom edge that grows back on a click; or a modal over the whole
 * window, as large as the window allows, since a draft is apart from what
 * is open. The body is the same composer in each, and grows taller once
 * something is attached, because what is attached is shown in full. Starting
 * sends the words, the files, and the topic as the first message of a new
 * thread, opens the thread with the files as its tabs, and puts the draft
 * away; the thread lands at the top of the list on its own.
 */
export function DraftWindow({
  modelURI,
  sendContext,
}: {
  modelURI: AIGatewayModelURI.Type | undefined;
  /** What the window has on screen when the thread starts, read at that moment. */
  sendContext: () => Promise<
    SessionMessageDataPart.ViewContextDataPart | undefined
  >;
}) {
  const { openScreen, taskId } = useOrchestrator();
  const [draft, setDraft] = useAtom(draftAtom);
  const [placement, setPlacement] = useAtom(draftPlacementAtom);
  const topicsQuery = useQuery(
    rpcClient.workspace.orchestrator.topics.list.queryOptions({
      input: { id: taskId },
    }),
  );
  const topics = topicsQuery.data ?? [];
  const createTopic = useMutation(
    rpcClient.workspace.orchestrator.topics.create.mutationOptions({
      onSuccess: () => void topicsQuery.refetch(),
    }),
  );
  const [isNewTopicOpen, setNewTopicOpen] = useState(false);
  const createMessage = useMutation(
    rpcClient.workspace.message.create.mutationOptions({
      onError: (error) => {
        toast.error("Failed to start the thread", {
          description: error.message,
        });
      },
    }),
  );
  const [isStarting, setStarting] = useState(false);

  if (placement === "closed") {
    return null;
  }

  const title = firstLineOf(draft.words) || "New thread";
  const hasFiles = draft.files.length > 0;
  const close = () => {
    setPlacement("closed");
  };
  const start = () => {
    if (!modelURI) {
      toast.error("Choose a model before starting a thread");
      return;
    }
    setStarting(true);
    void sendContext().then((viewing) => {
      createMessage.mutate(
        {
          files: draft.files.map(uploadOf),
          id: taskId,
          modelURI,
          prompt: draft.words,
          ...(draft.topicId ? { topics: [draft.topicId] } : {}),
          viewing,
        },
        {
          onSettled: () => {
            setStarting(false);
          },
          onSuccess: ({ sessionId }) => {
            const threadHref = `${THREADS_HREF}/${sessionId}`;
            setDraft(EMPTY_DRAFT);
            setPlacement("closed");
            // The thread's group comes up with the files gathered under the
            // words as its tabs, as they were, then the thread itself is
            // what is shown.
            openScreen(threadHref);
            for (const file of draft.files) {
              if (file.path) {
                openScreen(fileHref(file.path), { newTab: true });
              }
            }
            openScreen(threadHref);
          },
        },
      );
    });
  };
  const composer = (
    <DraftComposer
      draft={draft}
      isStarting={isStarting}
      onChange={setDraft}
      onNewTopic={() => {
        setNewTopicOpen(true);
      }}
      onStart={start}
      size={placement === "modal" ? "modal" : "window"}
      topics={topics}
    />
  );
  const newTopic = (
    <NewTopicDialog
      onCreate={(topic) => {
        createTopic.mutate({ ...topic, id: taskId });
      }}
      onOpenChange={setNewTopicOpen}
      open={isNewTopicOpen}
      taken={topics.flatMap((topic) => (topic.emoji ? [topic.emoji] : []))}
    />
  );

  if (placement === "bar") {
    return (
      <div
        aria-label="New thread"
        className="absolute right-4 bottom-0 z-30 flex h-9 w-72 items-center gap-1 rounded-t-lg border border-b-0 border-border bg-card pr-1 pl-3 shadow-lg"
        role="region"
      >
        <button
          className="flex h-full min-w-0 flex-1 items-center gap-2 text-left text-sm"
          onClick={() => {
            setPlacement("window");
          }}
          type="button"
        >
          <PencilSimpleIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{title}</span>
        </button>
        <HeadControl
          label="Expand"
          onClick={() => {
            setPlacement("modal");
          }}
        >
          <ArrowsOutSimpleIcon className="size-3.5" />
        </HeadControl>
        <HeadControl label="Close" onClick={close}>
          <XIcon className="size-3.5" />
        </HeadControl>
      </div>
    );
  }

  if (placement === "modal") {
    return (
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setPlacement("window");
          }
        }}
        open
      >
        <DialogContent
          aria-describedby={undefined}
          // Inset from the window's edges: what was on screen stays in view
          // around it, and the band the window is dragged by stays clear.
          className="flex h-[calc(100vh-7rem)] max-h-[calc(100vh-7rem)] w-[calc(100vw-8rem)] flex-col gap-0 rounded-2xl p-0"
          maxHeight="60rem"
          maxWidth="80rem"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">New thread</DialogTitle>
          <div className="flex h-9 shrink-0 items-center justify-end gap-1 px-2 pt-1">
            <HeadControl
              label="Shrink"
              onClick={() => {
                setPlacement("window");
              }}
            >
              <ArrowsInSimpleIcon className="size-3.5" />
            </HeadControl>
            <HeadControl label="Close" onClick={close}>
              <XIcon className="size-3.5" />
            </HeadControl>
          </div>
          {composer}
          {newTopic}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <section
      aria-label="New thread"
      className={cn(
        "absolute right-4 bottom-4 z-30 flex w-[min(40rem,calc(100%-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl",
        // Taller once something is attached: what is attached is shown in
        // full, and a strip of tabs over a sliver is no use.
        hasFiles ? "h-[min(46rem,calc(100%-2rem))]" : "max-h-[calc(100%-2rem)]",
      )}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/40 pr-1 pl-3">
        <PencilSimpleIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          New thread
        </span>
        <HeadControl
          label="Minimize"
          onClick={() => {
            setPlacement("bar");
          }}
        >
          <MinusIcon className="size-3.5" />
        </HeadControl>
        <HeadControl
          label="Expand"
          onClick={() => {
            setPlacement("modal");
          }}
        >
          <ArrowsOutSimpleIcon className="size-3.5" />
        </HeadControl>
        <HeadControl label="Close" onClick={close}>
          <XIcon className="size-3.5" />
        </HeadControl>
      </div>
      {composer}
      {newTopic}
    </section>
  );
}

/** The first line of the words, which is how the draft is named while it is a bar. */
function firstLineOf(words: string): string {
  return (
    words
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? ""
  );
}

/** One of the head's controls: a small tile in the window's own type. */
function HeadControl({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          onClick={onClick}
          type="button"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** A gathered file as the workspace takes it: by its path when it has one, else by its bytes. */
function uploadOf(file: DraftFile): Upload {
  return file.path
    ? {
        filename: file.name,
        mimeType: file.mimeType,
        path: file.path,
        size: file.size,
      }
    : { content: file.content ?? "", filename: file.name };
}
