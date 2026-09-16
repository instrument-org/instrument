import { useHydrateTaskDraft } from "@/client/atoms/prompt-value";
import {
  PromptInput,
  type PromptInputRef,
} from "@/client/components/prompt-input";
import { rpcClient } from "@/client/rpc/client";
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import {
  type SessionMessageDataPart,
  type TaskId,
} from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useAppsBySlug } from "./apps-by-slug";
import { FilterBar } from "./filter-bar";
import { EditTopicDialog, NewTopicDialog } from "./new-topic-dialog";
import { ThreadList } from "./thread-list";
import {
  matchesFilters,
  NO_FILTERS,
  type Thread,
  type ThreadFilters,
  type Topic,
} from "./threads";

// How long a sent message keeps the list following its end on its own before
// the thread it made has to justify it by working there.
const SUBMIT_FOLLOW_TIMEOUT_MS = 5000;

/**
 * The chat pane: the filter bar, the thread list, and the composer at its
 * foot. Sending here makes a thread; there is no session to send into, and
 * nothing to stop, since the reply lands in the thread rather than under the
 * field. Nothing shows before send.
 */
export function ThreadPane({
  modelURI: initialModelURI,
  onOpenThread,
  promptDraft,
  sendContext,
  taskId,
}: {
  modelURI: AIGatewayModelURI.Type | undefined;
  onOpenThread: (thread: Thread) => void;
  promptDraft: string;
  /** What the window has on screen when a message is sent, read at that moment. */
  sendContext: () => Promise<
    SessionMessageDataPart.ViewContextDataPart | undefined
  >;
  taskId: TaskId;
}) {
  // The route does not render until the task's state has loaded, so the stored
  // draft is in hand on the composer's very first render.
  useHydrateTaskDraft(taskId, promptDraft);
  const appsBySlug = useAppsBySlug();
  const threadsQuery = useQuery(
    rpcClient.workspace.orchestrator.threads.live.list.experimental_liveOptions(
      { input: { id: taskId } },
    ),
  );
  const topicsQuery = useQuery(
    rpcClient.workspace.orchestrator.topics.list.queryOptions({
      input: { id: taskId },
    }),
  );
  const threads: Thread[] = threadsQuery.data ?? [];
  const topics: Topic[] = topicsQuery.data ?? [];
  const afterTopicChange = { onSuccess: () => void topicsQuery.refetch() };
  const createTopic = useMutation(
    rpcClient.workspace.orchestrator.topics.create.mutationOptions(
      afterTopicChange,
    ),
  );
  const updateTopic = useMutation(
    rpcClient.workspace.orchestrator.topics.update.mutationOptions(
      afterTopicChange,
    ),
  );
  const retireTopic = useMutation(
    rpcClient.workspace.orchestrator.topics.retire.mutationOptions(
      afterTopicChange,
    ),
  );
  const setThreadTopics = useMutation(
    rpcClient.workspace.orchestrator.threads.setTopics.mutationOptions({
      onError: (error) => {
        toast.error("Failed to tag the thread", {
          description: error.message,
        });
      },
    }),
  );

  const [filters, setFilters] = useState<ThreadFilters>(NO_FILTERS);
  const [scrollSignal, setScrollSignal] = useState(0);
  // A change of filter is a change of subject, and the newest of the new
  // subject is what matters, so the list is taken to its end with it.
  const changeFilters = (next: ThreadFilters) => {
    setFilters(next);
    setScrollSignal((signal) => signal + 1);
  };
  const topicNames = new Map(topics.map((topic) => [topic.id, topic.name]));
  const shown = threads.filter((thread) =>
    matchesFilters(thread, filters, topicNames),
  );

  const [isNewTopicOpen, setNewTopicOpen] = useState(false);
  // The topic being renamed or re-marked, by id, so a re-read of the list does
  // not close the dialog under the user.
  const [editing, setEditing] = useState<{ id: string; picking: boolean }>();
  const editingTopic = topics.find((topic) => topic.id === editing?.id);

  const promptInputRef = useRef<PromptInputRef>(null);
  const [isFollowingSubmit, setFollowingSubmit] = useState(false);
  const [modelURI, setModelURI] = useState(initialModelURI);
  const [lastInitialModelURI, setLastInitialModelURI] =
    useState(initialModelURI);
  if (initialModelURI !== lastInitialModelURI) {
    setLastInitialModelURI(initialModelURI);
    setModelURI(initialModelURI);
  }
  const createMessage = useMutation(
    rpcClient.workspace.message.create.mutationOptions({
      onError: (error) => {
        toast.error("Failed to send", { description: error.message });
      },
    }),
  );
  // The newest thread working takes over following the end as soon as it
  // does; a send that never became one hands the list back after a while.
  const newest = threads.at(-1);
  const isNewestWorking = newest?.state === "working";
  if (isFollowingSubmit && isNewestWorking) {
    setFollowingSubmit(false);
  }
  useEffect(() => {
    if (!isFollowingSubmit) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setFollowingSubmit(false);
    }, SUBMIT_FOLLOW_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [isFollowingSubmit]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FilterBar
        appsBySlug={appsBySlug}
        filters={filters}
        onFiltersChange={changeFilters}
        onManageTopic={(action, topic) => {
          if (action === "retire") {
            retireTopic.mutate({ id: taskId, topicId: topic.id });
            changeFilters({
              ...filters,
              topics: filters.topics.filter((entry) => entry !== topic.id),
            });
          } else {
            setEditing({ id: topic.id, picking: action === "mark" });
          }
        }}
        onNewTopic={() => {
          setNewTopicOpen(true);
        }}
        threads={threads}
        topics={topics}
      />
      <ThreadList
        appsBySlug={appsBySlug}
        emptyLine={
          threads.length === 0
            ? "Ask for something below. Each ask becomes a thread here."
            : "Nothing matches."
        }
        isFollowing={isNewestWorking || isFollowingSubmit}
        onNewTopic={() => {
          setNewTopicOpen(true);
        }}
        onOpen={onOpenThread}
        onSetTopics={(thread, next) => {
          setThreadTopics.mutate({
            id: taskId,
            sessionId: thread.id,
            topics: next,
          });
        }}
        scrollSignal={scrollSignal}
        threads={shown}
        topics={topics}
      />
      <div className="shrink-0 px-3 pb-3">
        <PromptInput
          // Beside the work, the row stays open: a tab switch moves the caret,
          // and a row that folded and unfolded with it would animate on every
          // switch.
          alwaysOpen
          className="relative z-10"
          draftKey={{ scope: "task", taskId }}
          folderTrayPlacement="above"
          id={taskId}
          isLoading={createMessage.isPending}
          modelURI={modelURI}
          onModelChange={setModelURI}
          onSubmit={({ files, folders, modelURI: chosenModelURI, prompt }) => {
            // The composer empties on submit rather than on the reply, so a
            // send the workspace rejects has to hand the prompt and its
            // attachments back: nothing else holds them.
            const draft = promptInputRef.current?.snapshot();
            promptInputRef.current?.clear();
            // Sending is a request to watch what happens next, so a reader
            // who had scrolled back returns to the end and follows it.
            setFollowingSubmit(true);
            setScrollSignal((signal) => signal + 1);
            void sendContext().then((viewing) => {
              createMessage.mutate(
                {
                  files,
                  folders,
                  id: taskId,
                  modelURI: chosenModelURI,
                  prompt,
                  viewing,
                },
                {
                  onError: () => {
                    if (draft) {
                      promptInputRef.current?.restore(draft);
                    }
                  },
                },
              );
            });
          }}
          placeholder="What do you need?"
          ref={promptInputRef}
          variant="pill"
        />
      </div>
      <NewTopicDialog
        onCreate={(topic) => {
          createTopic.mutate({ ...topic, id: taskId });
        }}
        onOpenChange={setNewTopicOpen}
        open={isNewTopicOpen}
        taken={topics.flatMap((topic) => (topic.emoji ? [topic.emoji] : []))}
      />
      {editingTopic && editing && (
        <EditTopicDialog
          onChange={(edits) => {
            if (Object.keys(edits).length === 0) {
              return;
            }
            updateTopic.mutate({
              ...edits,
              id: taskId,
              topicId: editingTopic.id,
            });
          }}
          onOpenChange={(open) => {
            if (!open) {
              setEditing(undefined);
            }
          }}
          open
          picking={editing.picking}
          topic={editingTopic}
        />
      )}
    </div>
  );
}
