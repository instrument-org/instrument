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
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useAppsBySlug } from "./apps-by-slug";
import { FilterColumn } from "./filter-column";
import { EditTopicDialog, NewTopicDialog } from "./new-topic-dialog";
import { SearchField } from "./search-field";
import { ThreadList } from "./thread-list";
import {
  matchesFilters,
  NO_FILTERS,
  type Thread,
  type ThreadFilters,
  type Topic,
} from "./threads";
import { TopicBanner } from "./topic-banner";

/**
 * The chat pane: the sections down its left, and beside them the inbox with
 * the composer at its foot. Sending here makes a thread; there is no session
 * to send into, and nothing to stop, since the reply lands in the thread
 * rather than under the field. Nothing shows before send. With one topic
 * chosen in the column, the thread a send makes is filed under it, and the
 * topic's banner stands above the rows.
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
  // subject is what matters, so the list is taken back to its top with it.
  const changeFilters = (next: ThreadFilters) => {
    setFilters(next);
    setScrollSignal((signal) => signal + 1);
  };
  const topicNames = new Map(topics.map((topic) => [topic.id, topic.name]));
  const shown = threads.filter((thread) =>
    matchesFilters(thread, filters, topicNames),
  );
  // One topic chosen is the place the pane is standing in: the banner names
  // it, and the thread a send makes lands there.
  const chosenTopic =
    filters.topics.length === 1
      ? topics.find((topic) => topic.id === filters.topics[0])
      : undefined;

  const [isNewTopicOpen, setNewTopicOpen] = useState(false);
  // The topic whose details are open, by id, so a re-read of the list does
  // not close the dialog under the user.
  const [editingId, setEditingId] = useState<string>();
  const editingTopic = topics.find((topic) => topic.id === editingId);

  const promptInputRef = useRef<PromptInputRef>(null);
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

  return (
    // The pane is the container the column sizes itself by: it is the pane's
    // own width, not the window's, that says whether there is room for words
    // beside the marks.
    <div className="@container/chat flex h-full min-h-0">
      <FilterColumn
        appsBySlug={appsBySlug}
        filters={filters}
        onFiltersChange={changeFilters}
        onNewTopic={() => {
          setNewTopicOpen(true);
        }}
        onTopicDetails={(topic) => {
          setEditingId(topic.id);
        }}
        threads={threads}
        topics={topics}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Over the list rather than in the column, the way mail puts it:
          the search is about the rows, and it narrows whatever the column has
          chosen. */}
        <div className="shrink-0 px-3 pt-2 pb-1">
          <SearchField
            onChange={(search) => {
              changeFilters({ ...filters, search });
            }}
            value={filters.search}
          />
        </div>
        {chosenTopic && (
          <TopicBanner
            appsBySlug={appsBySlug}
            threads={shown}
            topic={chosenTopic}
          />
        )}
        <ThreadList
          appsBySlug={appsBySlug}
          emptyLine={emptyLineFor(filters, threads.length)}
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
            onSubmit={({
              files,
              folders,
              modelURI: chosenModelURI,
              prompt,
            }) => {
              // The composer empties on submit rather than on the reply, so a
              // send the workspace rejects has to hand the prompt and its
              // attachments back: nothing else holds them.
              const draft = promptInputRef.current?.snapshot();
              promptInputRef.current?.clear();
              // The thread a send makes lands at the top of the list, so a
              // reader who had scrolled down returns there to see it arrive.
              setScrollSignal((signal) => signal + 1);
              void sendContext().then((viewing) => {
                createMessage.mutate(
                  {
                    files,
                    folders,
                    id: taskId,
                    modelURI: chosenModelURI,
                    prompt,
                    ...(chosenTopic ? { topics: [chosenTopic.id] } : {}),
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
      </div>
      <NewTopicDialog
        onCreate={(topic) => {
          createTopic.mutate({ ...topic, id: taskId });
        }}
        onOpenChange={setNewTopicOpen}
        open={isNewTopicOpen}
        taken={topics.flatMap((topic) => (topic.emoji ? [topic.emoji] : []))}
      />
      {editingTopic && (
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
          // Deleting retires the topic: the tag goes from the column and from
          // the filter if it was the one chosen; the threads keep everything.
          onDelete={() => {
            retireTopic.mutate({ id: taskId, topicId: editingTopic.id });
            if (filters.topics.includes(editingTopic.id)) {
              changeFilters({ ...filters, topics: [] });
            }
          }}
          onOpenChange={(open) => {
            if (!open) {
              setEditingId(undefined);
            }
          }}
          open
          topic={editingTopic}
        />
      )}
    </div>
  );
}

/** What the list says when it has nothing to show, by where the column stands. */
function emptyLineFor(filters: ThreadFilters, total: number): string {
  if (filters.place === "drafts") {
    return "No drafts yet.";
  }
  if (filters.place === "unread") {
    return "Nothing unread.";
  }
  return total === 0
    ? "Ask for something below. Each ask becomes a thread here."
    : "Nothing matches.";
}
