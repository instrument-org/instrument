import { type Draft } from "@/shared/drafts";
import { openTopicDetails } from "@/client/atoms/topic-details-modal";
import { chatFiltersAtom } from "@/client/atoms/window";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { spokenMessage, toast } from "@/client/lib/toast";

import { useAppsBySlug } from "./apps-by-slug";
import { ChatList } from "./chat-list";
import { chatListOptions } from "./chat-list-query";
import {
  byLastUserMessage,
  type Chat,
  type ChatFilters,
  draftTitle,
  hasWords,
  matchesFilters,
  outsideFilters,
  spaceOf,
  type Topic,
  toSpace,
  widenToSearch,
} from "./chats";
import { FilterHead } from "./filter-head";
import {
  SETTLE_MS,
  type Space,
  SpaceSwitcher,
  useSpaceSwipe,
} from "./space-switcher";
import { DeleteChatDialog } from "./delete-chat-dialog";
import { TopicDialog } from "./topic-dialog";
import { TopicBanner } from "./topic-banner";
import { topicColor } from "./topic-colors";
import { topicTint } from "./topic-tint";
import { useChatSearchFallback } from "./use-chat-search-fallback";
import { useSetChatTopic } from "./use-set-chat-topic";
import { backfillCandidates } from "./use-topic-backfill";

/**
 * The chat pane: the inbox under the line that says where it stands and
 * searches it. Nothing is composed here: New in the rail opens
 * a draft, and the chat it starts lands at the top of the list; until it
 * is started it is a row of the Drafts place, which lists the drafts where
 * the chats otherwise go. With one topic chosen in the head, the topic's
 * banner stands above the rows.
 */
export function ChatPane({
  arrivedId,
  drafts,
  onArchiveOpen,
  onDeleted,
  onDeleteDraft,
  onListed,
  onOpenChat,
  onOpenDraft,
  onPopOut,
  openChatId,
  outIds,
}: {
  /** The chat that just started from a draft, whose row arrives with a motion of its own. */
  arrivedId?: string;
  /** Every draft not yet started, for the Drafts place and its count. */
  drafts: Draft[];
  /** Told when the open chat is archived from its row, so the window can put the chat away with it. */
  onArchiveOpen?: () => void;
  /** Told once a chat deleted from its row is in the trash, so the window can drop its tabs and put it away if it was open. */
  onDeleted: (id: ChatId) => void;
  /** Deletes a draft outright; the caller says so and offers it back. */
  onDeleteDraft: (id: string) => void;
  /** Told the chats the list shows, in its order, whenever that changes: what a chord steps through. */
  onListed?: (ids: ChatId[]) => void;
  onOpenChat: (chat: Chat) => void;
  /** Opens a draft to go on writing it. */
  onOpenDraft: (id: string) => void;
  /** Floats a chat in a window of its own over the row, from its row. */
  onPopOut?: (chat: Chat) => void;
  /** The chat open beside the list, if one is. */
  openChatId: string | undefined;
  /** The chats already up in a window of their own. */
  outIds?: ReadonlySet<string>;
}) {
  const appsBySlug = useAppsBySlug();
  const chatsQuery = useQuery(chatListOptions());
  const topicsQuery = useQuery(rpcClient.workspace.topics.list.queryOptions());
  const chats: Chat[] = chatsQuery.data ?? [];
  const topics: Topic[] = topicsQuery.data ?? [];
  const afterTopicChange = {
    onError: (error: Error) => {
      // A name a topic can't take comes back in words written for people.
      toast.error("Couldn't change the topic", {
        cause: error,
        description: spokenMessage(error, ["BAD_REQUEST"]),
      });
    },
    onSuccess: () => void topicsQuery.refetch(),
  };
  const createTopic = useMutation(
    rpcClient.workspace.topics.create.mutationOptions(afterTopicChange),
  );
  const setChatTopic = useSetChatTopic();

  const [filters, setFilters] = useAtom(chatFiltersAtom);
  // A change of filter is a change of subject, and the newest of the new
  // subject is what matters, so the list is taken back to its top with it.
  // Read off the filters rather than counted here, because the pane is not
  // the only thing that changes them: the command menu stands it in a topic.
  const scrollSignal = JSON.stringify(filters);
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
  });
  const isAISearch = aiSearch.isLooking || aiSearch.chats.length > 0;
  const shown = matched.length > 0 ? matched : aiSearch.chats;
  const listed = byLastUserMessage(shown).map((chat) => chat.id);
  // Keyed by value: the list is rebuilt on every read of the chats, and
  // the callback is written fresh each render; the ids are what matter.
  const listedKey = listed.join("\n");
  useEffect(() => {
    onListed?.(listed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listedKey]);
  // One topic chosen is the space the pane is standing in: the head names
  // it and its tint washes the column.
  const spaceTopicId = spaceOf(filters);
  const chosenTopic = topics.find((topic) => topic.id === spaceTopicId);
  // The drafts of the space: in a topic's, the ones that open a chat under it.
  const spaceDrafts = spaceTopicId
    ? drafts.filter((draft) => draft.topicId === spaceTopicId)
    : drafts;
  // Standing in Drafts, the list holds the drafts, narrowed by the same
  // search: by their words and the name of the topic each is filed under.
  const shownDrafts =
    filters.place === "drafts"
      ? spaceDrafts.filter((draft) =>
          hasWords(filters.search, [
            draftTitle(draft.words),
            draft.words,
            topicNames.get(draft.topicId ?? "") ?? "",
          ]),
        )
      : undefined;

  // The spaces along the foot, every chat first and then each topic in use,
  // and the one the pane stands in: every chat's for an app or a topic since
  // put away.
  const spaces: Space[] = [
    {},
    ...topics.flatMap((topic) => (topic.retired ? [] : [{ topic }])),
  ];
  const spaceIndex = Math.max(
    0,
    spaces.findIndex((space) => space.topic?.id === spaceTopicId),
  );
  const goToSpace = (index: number) => {
    const space = spaces[index];
    if (space) {
      setFilters(toSpace(filters, space.topic?.id));
    }
  };
  const paneRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const swipe = useSpaceSwipe({
    canStep: (direction) => spaces[spaceIndex + direction] !== undefined,
    isOn: spaces.length > 1,
    onStep: (direction) => {
      isSwiped.current = true;
      goToSpace(spaceIndex + direction);
    },
    ref: paneRef,
  });
  // The space a swipe in progress is heading for, whose tint it blends in.
  const swipeWay = swipe.offset < 0 ? 1 : -1;
  const neighbor =
    swipe.offset === 0 ? undefined : spaces[spaceIndex + swipeWay];
  const swipeNeighbor = neighbor ? spaceIndex + swipeWay : undefined;
  // The column follows the fingers with nothing easing it and eases only
  // while it settles where they let it go: once it lands, the space it
  // reached takes its place at rest on the next paint, since easing that
  // would slide the new space in a second time from where the old one was.
  const ease = `${SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
  const swipeEase = swipe.isSettling ? ease : "none";
  // The tints ease at rest as well, so a space chosen by a click blends in.
  const washEase = swipe.offset !== 0 && !swipe.isSettling ? "none" : ease;
  // A new space reached any way but a swipe, which brought it in already,
  // slides in from the side it was reached from: a click along the foot or
  // in the picker.
  const landedIndex = useRef(spaceIndex);
  const isSwiped = useRef(false);
  useEffect(() => {
    if (spaceIndex === landedIndex.current) {
      return;
    }
    const from = spaceIndex > landedIndex.current ? 1 : -1;
    landedIndex.current = spaceIndex;
    if (isSwiped.current) {
      isSwiped.current = false;
      return;
    }
    contentRef.current?.animate(
      [
        { opacity: 0, transform: `translateX(${from * 36}px)` },
        { opacity: 1, transform: "translateX(0)" },
      ],
      {
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 240,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    );
  }, [spaceIndex]);

  // Whether the new-topic dialog is up, and for which chat when a row
  // opened it: a topic made from a row is filed on that chat as it lands,
  // since that is what asking for one there means; one made from the head's
  // picker is the topic the list then stands in, since that is what picking
  // it means.
  const [newTopic, setNewTopic] = useState<{
    forChat?: Chat;
    name?: string;
  }>();
  // The chat whose row asked to delete it, by id, so a re-read of the list
  // does not close the dialog under the user.
  const [deletingId, setDeletingId] = useState<string>();
  const deletingChat = chats.find((chat) => chat.id === deletingId);

  return (
    // Its own stacking context, so the topic's wash can sit under the rows
    // without going under the card. The rows stop a pixel short of the
    // column's edge, where its line is drawn over them, so two see-through
    // hairlines never cross; the wash, placed against the padding box,
    // still reaches under the line.
    <div
      className="relative isolate flex h-full min-h-0 min-w-0 flex-col overflow-hidden pr-px"
      data-topic={chosenTopic ? "" : undefined}
      data-find-surface
      ref={paneRef}
    >
      {/* Each topic's tint washing down from the card's edge and fading out
          past the head, behind the first rows: one layer a topic, held still
          under the sliding column, so a swipe blends the one it leaves into
          the one it reaches as it goes rather than sliding a colored edge
          across. Sized against the whole column, so a taller window washes
          further down it. */}
      {spaces.map((space, index) => {
        if (!space.topic) {
          return null;
        }
        const strength =
          index === spaceIndex
            ? 1 - swipe.toward
            : index === swipeNeighbor
              ? swipe.toward
              : 0;
        return (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[calc(20%+14rem)] bg-linear-to-b from-(--topic-tint-surface)/50 to-transparent topic-tint dark:from-(--topic-tint-surface)/25"
            key={space.topic.id}
            style={{
              ...topicTint(topicColor(space.topic)),
              opacity: strength,
              // Following the fingers while they move; easing once they let
              // go or a space lands.
              transition: washEase === "none" ? "none" : `opacity ${washEase}`,
            }}
          />
        );
      })}
      {/* Everything that changes with the space, which follows a swipe and
          slides in when one lands; the spaces along the foot stay put. */}
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        ref={contentRef}
        style={{
          transform:
            swipe.offset === 0 ? undefined : `translateX(${swipe.offset}px)`,
          transition: swipeEase === "none" ? "none" : `transform ${swipeEase}`,
        }}
      >
        {/* The head, and while the list is one topic, the topic's own line
          under it, with the topic's tint washing down from the card's edge
          and fading out past the head, behind the first rows. */}
        <div
          className={cn("shrink-0", chosenTopic && "topic-tint")}
          style={chosenTopic ? topicTint(topicColor(chosenTopic)) : undefined}
        >
          <FilterHead
            chats={chats}
            drafts={spaceDrafts.length}
            filters={filters}
            // A head of its own for each space, so the one a swipe lands on
            // starts as the peek drew it, at rest, rather than easing its
            // mark in or out from how the last space's stood.
            key={spaceTopicId ?? "all"}
            onFiltersChange={setFilters}
            onNewTopic={() => {
              setNewTopic({});
            }}
            onTopicDetails={(topic) => {
              openTopicDetails(topic.id);
            }}
            topics={topics}
          />
          {chosenTopic && (
            <TopicBanner
              onDetails={(topic) => {
                openTopicDetails(topic.id);
              }}
              topic={chosenTopic}
            />
          )}
        </div>
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
          hasFoot={spaces.length > 1}
          emptyLine={
            aiSearch.isLooking
              ? "Looking through your chats…"
              : emptyLineFor(filters, chats.length, chosenTopic)
          }
          // The drafts are kept on this computer, so they are never on
          // their way.
          isLoading={shownDrafts === undefined && chatsQuery.data === undefined}
          onArchiveOpen={onArchiveOpen}
          onDelete={(chat) => {
            setDeletingId(chat.id);
          }}
          onDeleteDraft={onDeleteDraft}
          onNewTopic={(chat, name) => {
            setNewTopic({ forChat: chat, ...(name ? { name } : {}) });
          }}
          onOpen={onOpenChat}
          onOpenDraft={onOpenDraft}
          onPopOut={onPopOut}
          onSetTopic={(chat, next) => {
            setChatTopic(chat.id, next);
          }}
          onWiden={() => {
            setFilters(widenToSearch(filters));
          }}
          openId={openChatId}
          outIds={outIds}
          outside={outside}
          scrollSignal={scrollSignal}
          // The decision model's finds are not matches of the words, so
          // nothing on them is marked.
          search={isAISearch ? "" : filters.search}
          spaceTopicId={spaceTopicId}
          topics={topics}
        />
      </div>
      {/* The space a swipe is heading for, beside the column and moving
          with it, drawn as it will stand once it lands: its head, its line
          and its rows, none of them answering anything until then. */}
      {neighbor && (
        <div
          className="absolute inset-y-0 right-px left-0 flex flex-col"
          inert
          style={{
            transform: `translateX(calc(${swipe.offset}px + ${swipeWay * 100}%))`,
            transition:
              swipeEase === "none" ? "none" : `transform ${swipeEase}`,
          }}
        >
          <SpacePreview
            appsBySlug={appsBySlug}
            chats={chats}
            drafts={drafts}
            filters={toSpace(filters, neighbor.topic?.id)}
            hasFoot={spaces.length > 1}
            openChatId={openChatId}
            topics={topics}
          />
        </div>
      )}
      {spaces.length > 1 && (
        <SpaceSwitcher
          current={spaceIndex}
          onPick={goToSpace}
          spaces={spaces}
        />
      )}
      {deletingChat && (
        <DeleteChatDialog
          chat={deletingChat}
          onDeleted={() => {
            onDeleted(deletingChat.id);
          }}
          onOpenChange={(open) => {
            if (!open) {
              setDeletingId(undefined);
            }
          }}
          open
        />
      )}
      <TopicDialog
        candidates={backfillCandidates(
          chats.filter((chat) => chat.id !== newTopic?.forChat?.id),
        )}
        mode="create"
        {...(newTopic?.name ? { name: newTopic.name } : {})}
        onCreate={(topic, alsoFile) => {
          const forChat = newTopic?.forChat;
          createTopic.mutate(topic, {
            onSuccess: (created) => {
              // Chats offered were filed under nothing, so the new topic
              // is all they carry.
              for (const id of alsoFile) {
                setChatTopic(id, created.id);
              }
              if (forChat) {
                setChatTopic(forChat.id, created.id);
                return;
              }
              // Read at the moment it lands rather than from the render
              // that opened the dialog: the search may have moved since.
              setFilters((current) => ({
                ...current,
                apps: [],
                topics: [created.id],
              }));
            },
          });
        }}
        onOpenChange={(open) => {
          if (!open) {
            setNewTopic(undefined);
          }
        }}
        open={newTopic !== undefined}
        // A retired topic's name brings it back, so only the ones in use
        // are names a new topic cannot take.
        otherNames={topics.flatMap((topic) =>
          topic.retired ? [] : [topic.name],
        )}
        taken={topics.flatMap((topic) => (topic.emoji ? [topic.emoji] : []))}
      />
    </div>
  );
}

/**
 * A space as a swipe shows it on its way in: the head, the topic's line and
 * the rows, laid out as the pane lays them out so the picture and the space
 * it becomes are the same pixels, and doing nothing, since nothing in it can
 * be reached until it lands.
 */
function SpacePreview({
  appsBySlug,
  chats,
  drafts,
  filters,
  hasFoot,
  openChatId,
  topics,
}: {
  appsBySlug: ReturnType<typeof useAppsBySlug>;
  chats: Chat[];
  drafts: Draft[];
  filters: ChatFilters;
  hasFoot: boolean;
  openChatId: string | undefined;
  topics: Topic[];
}) {
  const topicId = spaceOf(filters);
  const topic = topics.find((each) => each.id === topicId);
  const topicNames = new Map(topics.map((each) => [each.id, each.name]));
  const spaceDrafts = topicId
    ? drafts.filter((draft) => draft.topicId === topicId)
    : drafts;
  const nothing = () => undefined;
  return (
    <>
      <div
        className={cn("shrink-0", topic && "topic-tint")}
        style={topic ? topicTint(topicColor(topic)) : undefined}
      >
        <FilterHead
          chats={chats}
          drafts={spaceDrafts.length}
          filters={filters}
          isPreview
          onFiltersChange={nothing}
          onNewTopic={nothing}
          onTopicDetails={nothing}
          topics={topics}
        />
        {topic && <TopicBanner onDetails={nothing} topic={topic} />}
      </div>
      <ChatList
        appsBySlug={appsBySlug}
        chats={chats.filter((chat) =>
          matchesFilters(chat, filters, topicNames),
        )}
        drafts={
          filters.place === "drafts"
            ? spaceDrafts.filter((draft) =>
                hasWords(filters.search, [
                  draftTitle(draft.words),
                  draft.words,
                ]),
              )
            : undefined
        }
        emptyLine={emptyLineFor(filters, chats.length, topic)}
        hasFoot={hasFoot}
        isLoading={false}
        onDelete={nothing}
        onDeleteDraft={nothing}
        onNewTopic={nothing}
        onOpen={nothing}
        onOpenDraft={nothing}
        onSetTopic={nothing}
        openId={openChatId}
        scrollSignal={JSON.stringify(filters)}
        search={filters.search}
        spaceTopicId={topicId}
        topics={topics}
      />
    </>
  );
}

/** What the list says when it has nothing to show, by where the column stands. */
function emptyLineFor(
  filters: ChatFilters,
  total: number,
  topic: Topic | undefined,
): string {
  const search = filters.search.trim();
  if (search !== "") {
    return `No chats match “${search}”`;
  }
  if (filters.place === "drafts") {
    return "You don't have any drafts right now";
  }
  if (filters.place === "unread") {
    return "You're all caught up";
  }
  if (filters.place === "starred") {
    return "Chats you star will show up here";
  }
  if (filters.place === "archived") {
    return "Chats you archive will show up here";
  }
  if (topic) {
    return `Chats you file under ${topic.name} will show up here`;
  }
  return total === 0 ? "Press New to start a chat" : "There's nothing here yet";
}
