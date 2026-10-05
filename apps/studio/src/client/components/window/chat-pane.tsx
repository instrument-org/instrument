import { chatFiltersAtom, type Draft } from "@/client/atoms/window";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useAppsBySlug } from "./apps-by-slug";
import { ChatList } from "./chat-list";
import { chatListOptions } from "./chat-list-query";
import {
  byActivity,
  type Chat,
  type ChatFilters,
  draftTitle,
  hasWords,
  matchesFilters,
  outsideFilters,
  type Topic,
  widenToSearch,
} from "./chats";
import { FilterHead } from "./filter-head";
import { EditTopicDialog, NewTopicDialog } from "./new-topic-dialog";
import { SearchField } from "./search-field";
import { TopicBanner } from "./topic-banner";
import { useChatSearchFallback } from "./use-chat-search-fallback";
import { useSetChatTopics } from "./use-set-chat-topics";
import { backfillCandidates } from "./use-topic-backfill";

/**
 * The chat pane: the inbox under the line that says where it stands, with
 * the search between them. Nothing is composed here: New in the rail opens
 * a draft, and the chat it starts lands at the top of the list; until it
 * is started it is a row of the Drafts place, which lists the drafts where
 * the chats otherwise go. With one topic chosen in the head, the topic's
 * banner stands above the rows.
 */
export function ChatPane({
  arrivedId,
  drafts,
  onDeleteDraft,
  onListed,
  onOpenChat,
  onOpenDraft,
  openChatId,
}: {
  /** The chat that just started from a draft, whose row arrives with a motion of its own. */
  arrivedId?: string;
  /** Every draft not yet started, for the Drafts place and its count. */
  drafts: Draft[];
  /** Deletes a draft outright; the caller says so and offers it back. */
  onDeleteDraft: (id: string) => void;
  /** Told the chats the list shows, in its order, whenever that changes: what a chord steps through. */
  onListed?: (ids: ChatId[]) => void;
  onOpenChat: (chat: Chat) => void;
  /** Opens a draft to go on writing it. */
  onOpenDraft: (id: string) => void;
  /** The chat open beside the list, if one is. */
  openChatId: string | undefined;
}) {
  const appsBySlug = useAppsBySlug();
  const chatsQuery = useQuery(chatListOptions());
  const topicsQuery = useQuery(rpcClient.workspace.topics.list.queryOptions());
  const chats: Chat[] = chatsQuery.data ?? [];
  const topics: Topic[] = topicsQuery.data ?? [];
  const afterTopicChange = {
    onError: (error: Error) => {
      toast.error(error.message);
    },
    onSuccess: () => void topicsQuery.refetch(),
  };
  const createTopic = useMutation(
    rpcClient.workspace.topics.create.mutationOptions(afterTopicChange),
  );
  const updateTopic = useMutation(
    rpcClient.workspace.topics.update.mutationOptions(afterTopicChange),
  );
  const retireTopic = useMutation(
    rpcClient.workspace.topics.retire.mutationOptions(afterTopicChange),
  );
  const setChatTopics = useSetChatTopics();

  const [filters, setFilters] = useAtom(chatFiltersAtom);
  const [scrollSignal, setScrollSignal] = useState(0);
  // A change of filter is a change of subject, and the newest of the new
  // subject is what matters, so the list is taken back to its top with it.
  const changeFilters = (next: ChatFilters) => {
    setFilters(next);
    setScrollSignal((signal) => signal + 1);
  };
  const topicNames = new Map(topics.map((topic) => [topic.id, topic.name]));
  const matched = chats.filter((chat) =>
    matchesFilters(chat, filters, topicNames),
  );
  const outside = outsideFilters(chats, filters, topicNames);
  // Words that turn up in no chat anywhere are handed to the decision
  // model, which reads the chats the other filters keep for the one the
  // search means; its finds stand in the list's place, under a line saying
  // where they came from.
  const aiSearch = useChatSearchFallback({
    active:
      filters.place !== "drafts" &&
      filters.search.trim() !== "" &&
      matched.length === 0 &&
      outside === 0,
    candidates: chats.filter((chat) =>
      matchesFilters(chat, { ...filters, search: "" }, topicNames),
    ),
    search: filters.search,
    topicNames,
  });
  const isAISearch = aiSearch.isLooking || aiSearch.chats.length > 0;
  const shown = matched.length > 0 ? matched : aiSearch.chats;
  const listed = byActivity(shown).map((chat) => chat.id);
  // Keyed by value: the list is rebuilt on every read of the chats, and
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
  // it.
  const chosenTopic =
    filters.topics.length === 1
      ? topics.find((topic) => topic.id === filters.topics[0])
      : undefined;

  // Whether the new-topic dialog is up, and for which chat when a row
  // opened it: a topic made from a row is filed on that chat as it lands,
  // since that is what asking for one there means; one made from the head's
  // picker is the topic the list then stands in, since that is what picking
  // it means.
  const [newTopic, setNewTopic] = useState<{
    forChat?: Chat;
    name?: string;
  }>();
  // The topic whose details are open, by id, so a re-read of the list does
  // not close the dialog under the user.
  const [editingId, setEditingId] = useState<string>();
  const editingTopic = topics.find((topic) => topic.id === editingId);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <FilterHead
        chats={chats}
        filters={filters}
        onFiltersChange={changeFilters}
        onNewTopic={() => {
          setNewTopic({});
        }}
        onTopicDetails={(topic) => {
          setEditingId(topic.id);
        }}
        topics={topics}
      />
      {/* Under the line rather than on it, the way mail puts it: the search
        is about the rows, and it narrows whatever the line has chosen. */}
      {/* `pb-1` on the list's own 4px: 8px down to the first row, the same
        as the field keeps from the pane's sides. */}
      <div className="shrink-0 px-2 pt-2 pb-1">
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
          chats={shown}
          onClear={() => {
            changeFilters({ ...filters, topics: [] });
          }}
          onDetails={(topic) => {
            setEditingId(topic.id);
          }}
          topic={chosenTopic}
        />
      )}
      {isAISearch && (
        <p className="shrink-0 px-4 pt-2 pb-1 text-xs font-medium text-muted-foreground">
          AI results
        </p>
      )}
      <ChatList
        appsBySlug={appsBySlug}
        arrivedId={arrivedId}
        chats={shown}
        drafts={shownDrafts}
        emptyLine={
          aiSearch.isLooking
            ? "Looking through your chats…"
            : emptyLineFor(filters, chats.length)
        }
        // The drafts are kept on this computer, so they are never on
        // their way.
        isLoading={shownDrafts === undefined && chatsQuery.data === undefined}
        onDeleteDraft={onDeleteDraft}
        onNewTopic={(chat, name) => {
          setNewTopic({ forChat: chat, ...(name ? { name } : {}) });
        }}
        onOpen={onOpenChat}
        onOpenDraft={onOpenDraft}
        onSetTopics={(chat, next) => {
          setChatTopics(chat.id, next);
        }}
        onWiden={() => {
          changeFilters(widenToSearch(filters));
        }}
        openId={openChatId}
        outside={outside}
        scrollSignal={scrollSignal}
        topics={topics}
      />
      <NewTopicDialog
        candidates={backfillCandidates(
          chats.filter((chat) => chat.id !== newTopic?.forChat?.id),
        )}
        {...(newTopic?.name ? { name: newTopic.name } : {})}
        onCreate={(topic, alsoFile) => {
          const forChat = newTopic?.forChat;
          createTopic.mutate(topic, {
            onSuccess: (created) => {
              // Chats offered were filed under nothing, so the new topic
              // is all they carry.
              for (const id of alsoFile) {
                setChatTopics(id, [created.id]);
              }
              if (forChat) {
                setChatTopics(forChat.id, [...forChat.topics, created.id]);
                return;
              }
              // Read at the moment it lands rather than from the render
              // that opened the dialog: the search may have moved since.
              setFilters((current) => ({
                ...current,
                apps: [],
                topics: [created.id],
              }));
              setScrollSignal((signal) => signal + 1);
            },
          });
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
            updateTopic.mutate({ ...edits, topicId: editingTopic.id });
          }}
          // Deleting retires the topic: the tag goes from the column and from
          // the filter if it was the one chosen; the chats keep everything.
          onDelete={() => {
            retireTopic.mutate({ topicId: editingTopic.id });
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
          otherNames={topics.flatMap((topic) =>
            topic.id === editingTopic.id ? [] : [topic.name],
          )}
          topic={editingTopic}
        />
      )}
    </div>
  );
}

/** What the list says when it has nothing to show, by where the column stands. */
function emptyLineFor(filters: ChatFilters, total: number): string {
  if (filters.place === "drafts") {
    return "No drafts yet.";
  }
  if (filters.place === "needsYou") {
    return "Nothing needs you.";
  }
  return total === 0 ? "Press New to start a chat." : "Nothing matches.";
}
