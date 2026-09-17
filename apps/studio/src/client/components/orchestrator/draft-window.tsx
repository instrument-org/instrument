import {
  draftAtom,
  type DraftFile,
  draftPlacementAtom,
  EMPTY_DRAFT,
} from "@/client/atoms/orchestrator";
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
import { NewTopicDialog } from "./new-topic-dialog";
import { THREADS_HREF } from "./screen-presentation";

type Upload = NonNullable<
  RPCInput["workspace"]["message"]["create"]["files"]
>[number];

/**
 * The draft of a new thread, drawn where the draft's placement says: a
 * window at the bottom right of the right area with a dark head carrying its
 * first words and the ways to shrink it to a bar, grow it across the area,
 * or put it away; a bar along the bottom edge that grows back on a click;
 * or the whole right area. The body is the same composer in each. Starting
 * sends the words, the files, and the topic as the first message of a new
 * thread, opens the thread in place, and puts the draft away; the thread
 * lands at the top of the list on its own.
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

  const title = firstLineOf(draft.words) || "New";
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
            setDraft(EMPTY_DRAFT);
            setPlacement("closed");
            openScreen(`${THREADS_HREF}/${sessionId}`);
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
      size={placement === "pane" ? "pane" : "window"}
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
        className="absolute right-4 bottom-0 z-30 flex h-9 w-72 items-center gap-1 rounded-t-lg bg-foreground pr-1 pl-3 text-background shadow-lg"
        role="region"
      >
        <button
          className="flex h-full min-w-0 flex-1 items-center gap-2 text-left text-sm"
          onClick={() => {
            setPlacement("window");
          }}
          type="button"
        >
          <PencilSimpleIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{title}</span>
        </button>
        <HeadControl
          label="Expand"
          onClick={() => {
            setPlacement("pane");
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

  if (placement === "pane") {
    return (
      <section
        aria-label="New thread"
        className="absolute inset-0 z-20 flex flex-col bg-background"
      >
        <div className="flex h-9 shrink-0 items-center justify-end gap-1 px-2">
          <HeadControl
            label="Shrink"
            onClick={() => {
              setPlacement("window");
            }}
            tone="light"
          >
            <ArrowsInSimpleIcon className="size-3.5" />
          </HeadControl>
          <HeadControl label="Close" onClick={close} tone="light">
            <XIcon className="size-3.5" />
          </HeadControl>
        </div>
        {composer}
        {newTopic}
      </section>
    );
  }

  return (
    <section
      aria-label="New thread"
      className="absolute right-4 bottom-4 z-30 flex max-h-[calc(100%-2rem)] w-[min(36rem,calc(100%-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 bg-foreground pr-1 pl-3 text-background">
        <PencilSimpleIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
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
            setPlacement("pane");
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

/** The first line of the words, which is how the draft is named while it is small. */
function firstLineOf(words: string): string {
  return (
    words
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? ""
  );
}

/** One of the head's controls: a small tile that reads on the dark head, or on the page when the draft has no head. */
function HeadControl({
  children,
  label,
  onClick,
  tone = "dark",
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  tone?: "dark" | "light";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-md",
            tone === "dark"
              ? "text-background/80 hover:bg-background/15 hover:text-background"
              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
          )}
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
