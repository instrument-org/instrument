import { type Draft } from "@/client/atoms/orchestrator";
import { rpcClient } from "@/client/rpc/client";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { atom, useAtom } from "jotai";
import { useEffect, useState } from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { FilterColumn, FilterHead } from "./filter-column";
import { EditTopicDialog, NewTopicDialog } from "./new-topic-dialog";
import { SearchField } from "./search-field";
import { ThreadList } from "./thread-list";
import {
  byActivity,
  draftTitle,
  hasWords,
  matchesFilters,
  NO_FILTERS,
  type Thread,
  type ThreadFilters,
  type Topic,
} from "./threads";
import { TopicBanner } from "./topic-banner";
import { useSetThreadTopics } from "./use-set-thread-topics";

/** Where the column stands and what the search says, kept outside the pane so the pane can be re-laid without losing them. */
const threadFiltersAtom = atom<ThreadFilters>(NO_FILTERS);

/**
 * The chat pane: the sections down its left, and beside them the inbox with
 * the search over it. Nothing is composed here: New in the column opens a
 * draft at the window's corner, and the thread it starts lands at the top of
 * the list; until it is started it is a row of the Drafts place, which lists
 * the drafts where the threads otherwise go. With one topic chosen in the
 * column, the topic's banner stands above the rows and a draft opened from
 * here is filed under it.
 */
export function ThreadPane({
  drafts,
  onDeleteDraft,
  onListed,
  onNew,
  onOpenDraft,
  onOpenThread,
  openThreadId,
  taskId,
}: {
  /** Every draft not yet started, for the Drafts place and its count. */
  drafts: Draft[];
  /** Deletes a draft outright; the caller says so and offers it back. */
  onDeleteDraft: (id: string) => void;
  /** Told the threads the list shows, in its order, whenever that changes: what a chord steps through. */
  onListed?: (ids: StoreId.Session[]) => void;
  /** Opens a draft of a new thread, filed under the topic the pane stands in when it stands in one. */
  onNew: (topicId: string | undefined) => void;
  /** Opens a draft to go on writing it. */
  onOpenDraft: (id: string) => void;
  onOpenThread: (thread: Thread) => void;
  /** The thread open beside the list, if one is. */
  openThreadId: string | undefined;
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
  const setThreadTopics = useSetThreadTopics(taskId);

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
  const listed = byActivity(shown).map((thread) => thread.id);
  // Keyed by value: the list is rebuilt on every read of the threads, and
  // the callback is written fresh each render; the ids are what matter.
  const listedKey = listed.join("\n");
  useEffect(() => {
    onListed?.(listed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listedKey]);
  // Standing in Drafts, the list holds the drafts, narrowed by the same
  // search: by their words and the name of the topic each is filed under.
  const shownDrafts =
    filters.place === "drafts"
      ? drafts.filter((draft) =>
          hasWords(filters.search, [
            draftTitle(draft.words),
            draft.words,
            topicNames.get(draft.topicId ?? "") ?? "",
          ]),
        )
      : undefined;
  // One topic chosen is the place the pane is standing in: the banner names
  // it, and a draft opened from here is filed there.
  const chosenTopic =
    filters.topics.length === 1
      ? topics.find((topic) => topic.id === filters.topics[0])
      : undefined;

  // Whether the new-topic dialog is up, and for which thread when a row
  // opened it: a topic made from a row is filed on that thread as it lands,
  // since that is what asking for one there means.
  const [newTopic, setNewTopic] = useState<{ forThread?: Thread }>();
  // The topic whose details are open, by id, so a re-read of the list does
  // not close the dialog under the user.
  const [editingId, setEditingId] = useState<string>();
  const editingTopic = topics.find((topic) => topic.id === editingId);
  const filterProps = {
    appsBySlug,
    filters,
    onFiltersChange: changeFilters,
    onNew: () => {
      onNew(chosenTopic?.id);
    },
    onTopicDetails: (topic: Topic) => {
      setEditingId(topic.id);
    },
    threads,
    topics,
  };

  return (
    // The pane is the container the column sizes itself by: it is the pane's
    // own width, not the window's, that says whether there is room for words
    // beside the marks.
    <div className="@container/chat flex h-full min-h-0">
      <FilterColumn {...filterProps} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* The column's choices over the list while the pane is too narrow
          for the column beside it. */}
        <FilterHead {...filterProps} />
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
            onClear={() => {
              changeFilters({ ...filters, topics: [] });
            }}
            onDetails={(topic) => {
              setEditingId(topic.id);
            }}
            threads={shown}
            topic={chosenTopic}
          />
        )}
        <ThreadList
          appsBySlug={appsBySlug}
          drafts={shownDrafts}
          emptyLine={emptyLineFor(filters, threads.length)}
          // The drafts are kept on this computer, so they are never on
          // their way.
          isLoading={
            shownDrafts === undefined && threadsQuery.data === undefined
          }
          onDeleteDraft={onDeleteDraft}
          onNewTopic={(thread) => {
            setNewTopic({ forThread: thread });
          }}
          onOpen={onOpenThread}
          onOpenDraft={onOpenDraft}
          onSetTopics={(thread, next) => {
            setThreadTopics(thread.id, next);
          }}
          openId={openThreadId}
          scrollSignal={scrollSignal}
          threads={shown}
          topics={topics}
        />
      </div>
      <NewTopicDialog
        onCreate={(topic) => {
          const forThread = newTopic?.forThread;
          createTopic.mutate(
            { ...topic, id: taskId },
            {
              onSuccess: (created) => {
                if (forThread) {
                  setThreadTopics(forThread.id, [
                    ...forThread.topics,
                    created.id,
                  ]);
                }
              },
            },
          );
        }}
        onOpenChange={(open) => {
          if (!open) {
            setNewTopic(undefined);
          }
        }}
        open={newTopic !== undefined}
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
  if (filters.place === "needsYou") {
    return "Nothing needs you.";
  }
  return total === 0
    ? "Press New to ask for something. Each ask becomes a thread here."
    : "Nothing matches.";
}
