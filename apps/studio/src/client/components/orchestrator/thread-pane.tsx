import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { atom, useAtom } from "jotai";
import { useState } from "react";
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

/** Where the column stands and what the search says, kept outside the pane so the pane can be re-laid without losing them. */
const threadFiltersAtom = atom<ThreadFilters>(NO_FILTERS);

/**
 * The chat pane: the sections down its left, and beside them the inbox with
 * the search over it. Nothing is composed here: New in the column opens a
 * draft at the window's corner, and the thread it starts lands at the top of
 * the list. With one topic chosen in the column, the topic's banner stands
 * above the rows and a draft opened from here is filed under it.
 */
export function ThreadPane({
  onNew,
  onOpenThread,
  taskId,
}: {
  /** Opens a draft of a new thread, filed under the topic the pane stands in when it stands in one. */
  onNew: (topicId: string | undefined) => void;
  onOpenThread: (thread: Thread) => void;
  taskId: TaskId;
}) {
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

  const [filters, setFilters] = useAtom(threadFiltersAtom);
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
  // it, and a draft opened from here is filed there.
  const chosenTopic =
    filters.topics.length === 1
      ? topics.find((topic) => topic.id === filters.topics[0])
      : undefined;

  const [isNewTopicOpen, setNewTopicOpen] = useState(false);
  // The topic whose details are open, by id, so a re-read of the list does
  // not close the dialog under the user.
  const [editingId, setEditingId] = useState<string>();
  const editingTopic = topics.find((topic) => topic.id === editingId);

  return (
    // The pane is the container the column sizes itself by: it is the pane's
    // own width, not the window's, that says whether there is room for words
    // beside the marks.
    <div className="@container/chat flex h-full min-h-0">
      <FilterColumn
        appsBySlug={appsBySlug}
        filters={filters}
        onFiltersChange={changeFilters}
        onNew={() => {
          onNew(chosenTopic?.id);
        }}
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
  if (filters.place === "archive") {
    return "Nothing put away yet.";
  }
  if (filters.place === "unread") {
    return "Nothing unread.";
  }
  return total === 0
    ? "Press New to ask for something. Each ask becomes a thread here."
    : "Nothing matches.";
}
