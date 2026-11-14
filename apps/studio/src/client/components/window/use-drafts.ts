import {
  draftKeyString,
  draftSnapshotsAtom,
} from "@/client/atoms/prompt-value";
import { cancelWords } from "@/client/drafts/settle-words";
import {
  claimDraftAtom,
  createDraftAtom,
  draftsAtom,
  draftSentAtom,
  releaseDraftAtom,
  removeDraftAtom,
} from "@/client/drafts/store";
import { type Draft, draftGroupOf, isLeftEmpty } from "@/shared/drafts";
import { chatFiltersAtom } from "@/client/atoms/window";
import { type useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { holdSendsUntilOpened } from "@/client/lib/message-sends";
import { rpcClient } from "@/client/rpc/client";
import {
  type ChatId,
  type LayoutRead,
  type SessionMessageDataPart,
  StoreId,
} from "@instrument-org/workspace/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import ms from "ms";
import { useEffect, useState } from "react";
import { finishBeforeLeaving } from "@/client/lib/before-leaving";
import { toast } from "@/client/lib/toast";
import { ulid } from "ulid";

import { type Project } from "./chats";
import { type BrowserTabsHandle } from "./browser-tabs";
import { pageToChat, pagesForChat } from "./draft-band";
import { type DraftSend } from "./compose-window";
import { asksPart, stagedAsksAtom, useStagedAskActions } from "./staged-asks";
import { type useCompose } from "./use-compose";
import { isHomeTab } from "./tab-model";
import { type useWindowTabs } from "./window-tabs";
import { getGroupTabRouter } from "@/client/lib/group-tab-router-registry";
import { chatHref, newChatHref } from "./window-href";

/** How long a chat just started from a draft is marked as arriving in the inbox; the row's own motion is shorter. */
const CHAT_ARRIVAL_MS = ms("3 seconds");

/**
 * A draft's life around where it is written: in the Chat screen, beside the
 * chat list, or in a window along the row's foot everywhere else; put away
 * with its words kept or thrown away with nothing written, moved between
 * the two, and started as the chat it is for. The windows and the screen are
 * the compose surfaces'; this is what happens to a draft on the way in and
 * out of one.
 */
export function useDrafts({
  browser,
  folders,
  compose,
  draftContext,
  isChat,
  isOpen,
  layoutOf,
  openDraftInChat,
  openDrafts,
  openNewChat,
  saveDefaultModelURI,
  projects,
  windowTabs,
}: {
  /** The window's browser, which opens the pages a draft names right after its chat's tab at the send. */
  browser: BrowserTabsHandle | null;
  /** The folders the window reaches, for how the agent reaches a file an ask is on. */
  folders: Record<string, { path: string }>;
  /** The windows along the row's foot, which a draft is written in. */
  compose: ReturnType<typeof useCompose>;
  /** What a draft has up beside it, read as its chat starts, with the tab it was written in. */
  draftContext: (
    draft: Draft,
    tabId: string | undefined,
  ) => Promise<SessionMessageDataPart.ViewContextDataPart | undefined>;
  /** Whether the tab up is the chat, whose inbox's project a new draft is filed under, and where a draft sent from there opens. */
  isChat: boolean;
  /** Whether what the window opens on is made; no chat starts before it is. */
  isOpen: boolean;
  /** The group of the tab a message goes from, as the chat reads it; see `layoutReadOf`. */
  layoutOf?: (tabId: string) => LayoutRead | undefined;
  /** Puts the tab up on the Chat screen writing a draft, beside the chat list. */
  openDraftInChat: (id: string) => void;
  /** Opens History, where a kept draft no tab writes is listed. */
  openDrafts: () => void;
  /** Puts the tab up on the Chat screen writing a new chat with nothing in it yet, filed under the project named. */
  openNewChat: (projectId: string | undefined) => void;
  /** Keeps the model a chat was started with as the one the next draft opens with. */
  saveDefaultModelURI: ReturnType<typeof useDefaultModelURI>[2];
  /** The projects, for the one the inbox stands in. */
  projects: Project[];
  windowTabs: Pick<ReturnType<typeof useWindowTabs>, "allTabs" | "replace">;
}) {
  const store = useStore();
  const drafts = useAtomValue(draftsAtom);
  const createDraft = useSetAtom(createDraftAtom);
  const removeDraft = useSetAtom(removeDraftAtom);
  const claimDraft = useSetAtom(claimDraftAtom);
  const releaseDraft = useSetAtom(releaseDraftAtom);
  const draftSent = useSetAtom(draftSentAtom);
  const setDraftSnapshots = useSetAtom(draftSnapshotsAtom);
  const chatFilters = useAtomValue(chatFiltersAtom);
  const queryClient = useQueryClient();
  const stagedAsks = useAtomValue(stagedAsksAtom);
  const { remove: removeAsks, returnTo: returnAsks } = useStagedAskActions();
  const createMessage = useMutation(
    rpcClient.workspace.message.create.mutationOptions(),
  );
  // The chats whose first messages are on their way, by chat, with the
  // words each sent: the chat shows them from the press, and keeps showing
  // them until its own transcript has them, a moment past the call's answer.
  const [sentWords, setSentWords] = useState<ReadonlyMap<ChatId, string>>(
    () => new Map(),
  );
  // The project each of those chats was sent under, by chat, which the
  // chat's head wears until the chat's own record files it.
  const [sentProjects, setSentProjects] = useState<ReadonlyMap<ChatId, string>>(
    () => new Map(),
  );
  const [startingIds, setStartingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // The drafts thrown away whose Undo is still on offer: out of Drafts, but
  // not deleted until the offer goes.
  const [discardingIds, setDiscardingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // The chat a draft just became, and the draft it was, for as long as
  // its row's arrival lasts.
  const [arrived, setArrived] = useState<{
    chatId: ChatId;
    draftId: string;
  }>();
  useEffect(() => {
    if (arrived === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      setArrived(undefined);
      setSentWords((current) => withoutKey(current, arrived.chatId));
      setSentProjects((current) => withoutKey(current, arrived.chatId));
    }, CHAT_ARRIVAL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [arrived]);
  /**
   * Brings a draft up to go on writing it: in the Chat screen, beside the
   * chat list, while the tab is on Chat, and in a window along the foot
   * everywhere else.
   */
  const showDraft = (id: string) => {
    if (isChat) {
      compose.remove(draftGroupOf(id));
      openDraftInChat(id);
    } else {
      compose.open(id);
    }
  };
  /** Takes a draft's window into the Chat screen, written there in full. */
  const expandDraft = (id: string) => {
    compose.remove(draftGroupOf(id));
    openDraftInChat(id);
  };
  /** Sends the draft the Chat screen is writing to a window along the foot, leaving a new chat in its place. */
  const popOutDraft = (id: string) => {
    compose.open(id);
    openNewChat(undefined);
  };
  /**
   * Makes a draft, filed under a project when the pane stands in one and with
   * words already in it when a button handed some over, and brings it up
   * where drafts are written from where the tab stands (see `showDraft`).
   * Every ask is a new draft, beside the ones already open.
   */
  const startDraft = (projectId: string | undefined, words = "") => {
    const now = Date.now();
    const draft: Draft = {
      createdAt: now,
      id: ulid(),
      ...(projectId ? { projectId } : {}),
      updatedAt: now,
      words,
    };
    createDraft(draft);
    showDraft(draft.id);
    return draft.id;
  };
  /** The project the inbox stands in, while the tab is on Chat and the inbox stands in one. */
  const inboxProject = () =>
    isChat && chatFilters.projects.length === 1
      ? projects.find((project) => project.id === chatFilters.projects[0])?.id
      : undefined;
  /**
   * A draft a button hands over a line to, made at once since it has
   * something in it, filed as New files one.
   */
  const draftWith = (words = "") => startDraft(inboxProject(), words);
  /**
   * A new chat a link from outside asked for, with its words: a draft of its
   * own beside any already open, so nothing the person wrote is replaced,
   * filed under the project it names only when there is one by that id.
   */
  const draftFromLink = (words: string, projectId?: string) => {
    startDraft(projects.find((project) => project.id === projectId)?.id, words);
  };
  // What a draft's composer held is kept only as long as the draft: a
  // composer unmounting keeps its snapshot as it goes, so a draft sent or
  // thrown away is pruned here, after that.
  const draftIds = drafts.map((draft) => draft.id).join("\n");
  useEffect(() => {
    const keep = new Set(draftIds.split("\n"));
    setDraftSnapshots((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) => keep.has(id)),
      ),
    );
  }, [draftIds, setDraftSnapshots]);
  /**
   * Throws a draft away: its window, its folder with what its composer held,
   * and its tabs. Answers once main has taken it away.
   */
  const deleteDraft = (id: string) => {
    // What was marked for it goes back to its file's Ask, to be sent another way.
    returnAsks({ draftId: id, kind: "draft" });
    compose.remove(draftGroupOf(id));
    return removeDraft(id);
  };
  /**
   * Throws a draft away on the person's say, from its window or from Drafts,
   * with a moment to take it back: its window goes and it leaves Drafts at
   * once, and it is deleted only once the toast offering Undo is gone, or
   * the window goes or the app quits first, since nothing is left to offer
   * Undo then. Undo puts it back in Drafts, with its window back up if it
   * had one.
   */
  const discardDraft = (id: string) => {
    const wasOpen = compose.entries.some(
      (entry) => entry.kind === "draft" && entry.draftId === id,
    );
    compose.remove(draftGroupOf(id));
    setDiscardingIds((current) => new Set(current).add(id));
    let isSettled = false;
    const settle = (keep: boolean) => {
      if (isSettled) {
        return undefined;
      }
      isSettled = true;
      leave();
      setDiscardingIds((current) => withoutId(current, id));
      if (!keep) {
        return deleteDraft(id);
      }
      if (wasOpen) {
        showDraft(id);
      }
      return undefined;
    };
    const leave = finishBeforeLeaving(() => settle(false));
    toast("Your draft was discarded", {
      action: {
        label: "Undo",
        onClick: () => {
          void settle(true);
        },
      },
      onAutoClose: () => {
        void settle(false);
      },
      onDismiss: () => {
        void settle(false);
      },
    });
  };
  /**
   * Closes a draft's window: one with anything in it is kept, listed in
   * History, with a toast offering to go there, and
   * one left empty (`isLeftEmpty`, the rule the Chat
   * screen's new chat keeps too) is thrown away, so a draft opened and
   * closed again leaves nothing behind. The words come from the window,
   * since the record follows the box a beat behind. One still dictating is
   * kept, since the words on their way land in it.
   */
  const closeDraft = (id: string, words: string, dictating = false) => {
    const draft = store.get(draftsAtom).find((entry) => entry.id === id);
    const hasTabs = windowTabs.allTabs.some(
      (tab) => tab.group === draftGroupOf(id) && !isHomeTab(tab),
    );
    if (!dictating && (!draft || isLeftEmpty(draft, { hasTabs, words }))) {
      void deleteDraft(id);
      return;
    }
    compose.remove(draftGroupOf(id));
    toast("Your draft is saved in History", {
      action: {
        label: "View",
        onClick: () => {
          openDrafts();
        },
      },
    });
  };
  /**
   * Starts the chat the draft is for: what its composer sends (the words,
   * the files, the folders, the model) and its project as the first message,
   * with what its band shows as the context; then what the draft gathered
   * becomes the chat's tabs exactly as they are. Sent from the chat, the
   * window goes and the tab up opens the chat whole; sent from anywhere
   * else, the window becomes the chat's small view in the same corner and
   * the place under it is left as it is. Either way the words sent stand
   * in its transcript from the press, and the chat's row arrives in the
   * inbox marked. A send that fails brings the draft back up with what it
   * held. `sentFrom` is the tab the draft was written in, which becomes its
   * chat, named by the screen sending it since a draft made in the same
   * press is not in the tab's address yet; none for a draft sent from a
   * window along the foot.
   */
  const startChat = (id: string, send: DraftSend, sentFrom?: string) => {
    // Read from the store rather than this render: a new chat's draft can be
    // made in the same press that sends it.
    const draft = store.get(draftsAtom).find((entry) => entry.id === id);
    if (!draft || !isOpen || startingIds.has(id)) {
      return;
    }
    // Read at the press, while the draft's window and what its band has up
    // are still there to read; the window changes under it at once.
    // With the chips it showed, for the transcript to draw.
    const viewing = draftContext(draft, sentFrom).catch(() => undefined);
    const layoutSent =
      sentFrom === undefined ? undefined : layoutOf?.(sentFrom);
    // Chosen here rather than by the workspace, so the window can be the
    // chat's before the chat exists.
    const sessionId = StoreId.newSessionId();
    // The window becomes the chat before this message has left, so anything
    // sent from it waits for this one to land first.
    const opened = holdSendsUntilOpened(sessionId);
    setStartingIds((current) => new Set(current).add(id));
    // The model chosen for the chat is the one the next draft opens with.
    saveDefaultModelURI(send.modelURI);
    // What was marked in files and moved to this draft goes as its asks.
    const marked = stagedAsks.filter(
      (ask) =>
        ask.destination?.kind === "draft" && ask.destination.draftId === id,
    );
    const asks = asksPart(marked, folders);
    void (async () => {
      // The chat's record is made first, so the window never shows a chat
      // whose record is not there yet; it is a folder and a settings file,
      // so the press still feels immediate.
      let chatId: ChatId;
      try {
        ({ id: chatId } = await rpcClient.workspace.chats.ensure.call({
          firstWords: send.prompt,
          sessionId,
        }));
        // Known at once to the chat's screen, which asks for its session.
        queryClient.setQueryData(
          rpcClient.workspace.chats.session.queryKey({
            input: { id: chatId },
          }),
          { sessionId },
        );
      } catch (error) {
        opened();
        setStartingIds((current) => withoutId(current, id));
        toast.error("Couldn't start the chat", { cause: error });
        return;
      }
      // The draft is claimed for its chat before anything is written to the
      // chat: from here it is the message on its way rather than a draft to
      // list or a reply in the chat, and its file names the chat, since the
      // message naming the draft is what says it was sent and a launch after
      // a crash finds that message by the chat the draft names. A draft whose
      // file cannot be written is still sent; what is lost is the chance to
      // finish the send later. The words go with the claim, so nothing typed
      // a beat before the press is left to be written after it.
      cancelWords(draftKeyString({ draftId: id, scope: "draft" }));
      await claimDraft({ chatId, id, words: send.prompt }).catch(
        () => undefined,
      );
      setSentWords((current) => new Map(current).set(chatId, send.prompt));
      const { projectId } = draft;
      if (projectId !== undefined) {
        setSentProjects((current) => new Map(current).set(chatId, projectId));
      }
      if (sentFrom) {
        compose.remove(draftGroupOf(id));
        // The tab the draft was written in is the chat from here, in place,
        // where back does not go to the draft it was. Each web page the
        // draft names by its address, and no tab of its group shows, opens
        // right after it (`pageToChat`).
        turnTab(sentFrom, chatHref(chatId));
        const chatTab = windowTabs.allTabs.find((tab) => tab.id === sentFrom);
        if (chatTab?.group !== undefined) {
          const { group } = chatTab;
          const own = windowTabs.allTabs.filter((tab) => tab.group === group);
          for (const url of pagesForChat(draft, own).toReversed()) {
            pageToChat({ browser, chatTab: { group, id: sentFrom }, url });
          }
        }
      } else {
        compose.becomeChat(id, chatId);
      }
      // Each send settles on its own: the mutation observer follows only the
      // latest call, so callbacks handed to it would be lost for a draft sent
      // while another was still on its way.
      const message = {
        ...(asks ? { asks } : {}),
        files: send.files,
        folders: send.folders,
        fromDraft: id,
        id: chatId,
        ...(layoutSent ? { layout: layoutSent } : {}),
        modelURI: send.modelURI,
        prompt: send.prompt,
        ...(draft.projectId ? { project: draft.projectId } : {}),
      };
      let failed: { error: unknown } | undefined;
      try {
        await createMessage.mutateAsync({
          ...message,
          // A context that cannot be gathered is a chat told less, not a
          // chat that never starts: the send goes on without it.
          viewing: await viewing,
        });
      } catch (error) {
        failed = { error };
      }
      if (failed) {
        releaseDraft(id);
        if (sentFrom) {
          turnTab(sentFrom, newChatHref(id));
        } else {
          compose.becomeDraft(chatId, id);
        }
        setSentWords((current) => withoutKey(current, chatId));
        setSentProjects((current) => withoutKey(current, chatId));
        toast.error("Couldn't start the chat", { cause: failed.error });
      }
      opened();
      setStartingIds((current) => withoutId(current, id));
      if (failed) {
        return;
      }
      // The message naming this draft is written by now, and the chat has
      // its own copies of what was attached, so the draft's folder can go
      // with it. A launch that finds the folder still there finds that
      // message too, and takes the folder away then.
      draftSent(id);
      removeAsks(marked.map((ask) => ask.id));
      setArrived({ chatId, draftId: id });
    })();
  };
  /** A tab sent to another address in place, its history's step replaced rather than added to. */
  const turnTab = (tabId: string, href: string) => {
    const router = getGroupTabRouter(tabId);
    if (router) {
      router.history.replace(href);
      return;
    }
    const tab = windowTabs.allTabs.find((entry) => entry.id === tabId);
    if (tab?.kind === "screen") {
      windowTabs.replace(tabId, { ...tab, history: undefined, href });
    }
  };
  return {
    arrivedId: arrived?.chatId,
    closeDraft,
    discardDraft,
    discardingIds,
    draftFromLink,
    draftWith,
    expandDraft,
    popOutDraft,
    sentProjects,
    sentWords,
    showDraft,
    startChat,
    startingIds,
  };
}

function withoutId(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(ids);
  next.delete(id);
  return next;
}

function withoutKey<K, T>(map: ReadonlyMap<K, T>, key: K): ReadonlyMap<K, T> {
  const next = new Map(map);
  next.delete(key);
  return next;
}
