import {
  chatFiltersAtom,
  type ChosenItem,
  type Draft,
  draftGroupOf,
  draftsAtom,
  draftSnapshotsAtom,
  NEW_TAB_HREF,
  paneOpenByGroupAtom,
} from "@/client/atoms/window";
import { type useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import {
  type SessionMessageDataPart,
  StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import ms from "ms";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ulid } from "ulid";

import { appTabsAtom } from "./app-tabs";
import { type Topic } from "./chats";
import { type DraftSend } from "./compose-window";
import { isGroupShown, isIncludable, tabInView } from "./draft-context";
import { asksPart, stagedAsksAtom, useStagedAskActions } from "./staged-asks";
import { type useCompose } from "./use-compose";
import { isHomeTab, type useWindowTabs } from "./window-tabs";

/** How long a chat just started from a draft is marked as arriving in the inbox; the row's own motion is shorter. */
const CHAT_ARRIVAL_MS = ms("3 seconds");

/**
 * A draft's life around its window: made and brought up along the row's
 * foot, put away with its words kept or thrown away with nothing written,
 * and started as the chat it is for. The windows themselves are the
 * compose surface's; this is what happens to a draft on the way in and out
 * of one.
 */
export function useDrafts({
  activeHref,
  attachedFolders,
  compose,
  draftContext,
  ids,
  isChat,
  saveDefaultModelURI,
  topics,
  windowTabs,
}: {
  /** Where the window's tab up stands, which a draft opened over a screen of its own is opened on. */
  activeHref: string;
  /** The orchestrator's granted folders, for how the agent reaches a file an ask is on. */
  attachedFolders: Record<string, { mountName: string; path: string }>;
  /** The windows along the row's foot, which a draft is written in. */
  compose: ReturnType<typeof useCompose>;
  /** What a draft's window has up, read as its chat starts. */
  draftContext: (
    draftId: string,
  ) => Promise<SessionMessageDataPart.ViewContextDataPart | undefined>;
  /** The orchestrator, once it exists; no chat starts before it does. */
  ids: RPCOutput["workspace"]["window"]["ensure"] | undefined;
  /** Whether the tab up is the chat, whose inbox's topic a new draft is filed under. */
  isChat: boolean;
  /** Keeps the model a chat was started with as the one the next draft opens with. */
  saveDefaultModelURI: ReturnType<typeof useDefaultModelURI>[2];
  /** The orchestrator's topics, for the one the inbox stands in. */
  topics: Topic[];
  windowTabs: ReturnType<typeof useWindowTabs>;
}) {
  const [drafts, setDrafts] = useAtom(draftsAtom);
  const setDraftSnapshots = useSetAtom(draftSnapshotsAtom);
  const chatFilters = useAtomValue(chatFiltersAtom);
  const paneOpenByGroup = useAtomValue(paneOpenByGroupAtom);
  const appTabs = useAtomValue(appTabsAtom);
  const queryClient = useQueryClient();
  const stagedAsks = useAtomValue(stagedAsksAtom);
  const { remove: removeAsks, returnTo: returnAsks } = useStagedAskActions();
  const createMessage = useMutation(
    rpcClient.workspace.message.create.mutationOptions(),
  );
  // The drafts whose first messages are on their way, by id, with the words
  // each sent: the chat's window shows them from the press, and keeps
  // showing them until the chat's own transcript has them, a moment past
  // the call's answer.
  const [sentWords, setSentWords] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [startingIds, setStartingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // The chat a draft just became, and the draft it was, for as long as
  // its row's arrival lasts.
  const [arrived, setArrived] = useState<{
    draftId: string;
    sessionId: StoreId.Session;
  }>();
  useEffect(() => {
    if (arrived === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      setArrived(undefined);
      setSentWords((current) => withoutKey(current, arrived.draftId));
    }, CHAT_ARRIVAL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [arrived]);
  /** Brings a draft up in a window along the foot, to go on writing it. */
  const showDraft = (id: string) => {
    compose.open(id);
  };
  /**
   * Makes a draft, filed under a topic when the pane stands in one and with
   * words already in it when a button handed some over, and brings it up in
   * a window of its own with the new-tab page as its first tab: the place to
   * find a site, a folder, a file, or an app to gather. Every ask is a new
   * draft, beside the ones already open.
   */
  const startDraft = (
    topicId: string | undefined,
    words = "",
    chosen: ChosenItem[] = [],
  ) => {
    const now = Date.now();
    // What the draft is opened over: the tab in view, when it is something
    // the conversation can be told about: the tab open in the chat's pane
    // beside it, or a site the tab up shows.
    const overGroup = windowTabs.group;
    const over =
      overGroup !== undefined && isGroupShown(overGroup, paneOpenByGroup)
        ? windowTabs.tabUpIn(overGroup)
        : undefined;
    const inPlace =
      overGroup !== undefined && over !== undefined && isIncludable(over)
        ? { group: overGroup, tabId: over.id }
        : undefined;
    // Or the window's own tab, when it stands on a screen of its own (a
    // folder, a file, an app's front) and the draft was not opened on
    // things by name: the draft follows that tab wherever it goes next.
    const appTabId = appTabs.selectedId;
    const onScreen =
      inPlace === undefined && chosen.length === 0 && appTabId !== null
        ? tabInView({
            activeHref,
            appTabId,
            groupTab: undefined,
            isGroupTabShown: false,
          })
        : undefined;
    const included =
      inPlace ??
      (onScreen && appTabId !== null && isIncludable(onScreen)
        ? { appTabId }
        : undefined);
    const draft: Draft = {
      ...(chosen.length > 0 ? { chosen } : {}),
      createdAt: now,
      id: ulid(),
      ...(included ? { included } : {}),
      ...(topicId ? { topicId } : {}),
      updatedAt: now,
      words,
    };
    setDrafts((current) => [...current, draft]);
    windowTabs.openScreen(NEW_TAB_HREF, {
      activate: true,
      group: draftGroupOf(draft.id),
    });
    showDraft(draft.id);
    return draft.id;
  };
  /**
   * New, from the rail or its chord, or a button handing over a line: a
   * draft filed under the topic the inbox stands in while it stands in one,
   * with the window put on the chat, which is where a draft is written.
   */
  const newDraft = (words?: string, chosen?: ChosenItem[]) =>
    startDraft(
      isChat && chatFilters.topics.length === 1
        ? topics.find((topic) => topic.id === chatFilters.topics[0])?.id
        : undefined,
      typeof words === "string" ? words : "",
      chosen,
    );
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
  /** Throws a draft away: its window, its record, what its composer held, and its tabs. */
  const deleteDraft = (id: string) => {
    // What was marked for it goes back to its file's Ask, to be sent another way.
    returnAsks({ draftId: id, kind: "draft" });
    compose.remove(draftGroupOf(id));
    setDrafts((current) => current.filter((draft) => draft.id !== id));
    windowTabs.dropGroup(draftGroupOf(id));
  };
  /**
   * Closes a draft's window: one with words is kept in Drafts the way mail
   * keeps a draft, and one with nothing written is thrown away, whatever it
   * gathered, so a draft opened and closed again leaves nothing behind. The
   * words come from the window, since the record follows the box a beat
   * behind.
   */
  const closeDraft = (id: string, words: string) => {
    if (words.trim() === "") {
      deleteDraft(id);
    } else {
      compose.remove(draftGroupOf(id));
    }
  };
  /**
   * Starts the chat the draft is for: what its composer sends (the words,
   * the files, the folders, the model) and its topic as the first message,
   * with what its band shows as the context; then what the draft gathered
   * becomes the chat's tabs exactly as they are. The window becomes the
   * chat's small view in the same corner at the press, with the words
   * sent standing in its transcript, and the place under it is left as it
   * is; the chat's row arrives in the inbox marked. A send that fails
   * turns the window back into the draft, with what it held.
   */
  const startChat = (id: string, send: DraftSend) => {
    const draft = drafts.find((entry) => entry.id === id);
    if (!draft || !ids || startingIds.has(id)) {
      return;
    }
    // Read at the press, while the draft's window and what its band has up
    // are still there to read; the window changes under it at once.
    // eslint-disable-next-line unicorn/no-useless-undefined -- the send's `viewing` takes undefined, not void
    const viewing = draftContext(id).catch(() => undefined);
    // Chosen here rather than by the workspace, so the window can be the
    // chat's before the chat exists.
    const sessionId = StoreId.newSessionId();
    setStartingIds((current) => new Set(current).add(id));
    setSentWords((current) => new Map(current).set(id, send.prompt));
    // The model chosen for the chat is the one the next draft opens with.
    saveDefaultModelURI(send.modelURI);
    // What was marked in files and moved to this draft goes as its asks.
    const marked = stagedAsks.filter(
      (ask) =>
        ask.destination?.kind === "draft" && ask.destination.draftId === id,
    );
    const asks = asksPart(marked, attachedFolders);
    void (async () => {
      // The chat's record is made first, so the window never shows a chat
      // whose record is not there yet; it is a folder and a settings file,
      // so the press still feels immediate.
      let chatId: TaskId;
      try {
        ({ taskId: chatId } = await rpcClient.workspace.chats.ensure.call({
          firstWords: send.prompt,
          sessionId,
        }));
        // Known at once to the chat's screen, which asks for its chat.
        queryClient.setQueryData(
          rpcClient.workspace.chats.of.queryKey({
            input: { sessionId },
          }),
          { taskId: chatId },
        );
      } catch (error) {
        setStartingIds((current) => withoutId(current, id));
        setSentWords((current) => withoutKey(current, id));
        toast.error("Failed to start the chat", {
          description: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      compose.becomeChat(id, sessionId);
      // Each send settles on its own: the mutation observer follows only the
      // latest call, so callbacks handed to it would be lost for a draft sent
      // while another was still on its way.
      try {
        await createMessage.mutateAsync({
          ...(asks ? { asks } : {}),
          files: send.files,
          folders: send.folders,
          id: chatId,
          modelURI: send.modelURI,
          newSessionId: sessionId,
          output: send.output,
          prompt: send.prompt,
          ...(draft.topicId ? { topics: [draft.topicId] } : {}),
          // A context that cannot be gathered is a chat told less, not a
          // chat that never starts: the send goes on without it.
          viewing: await viewing,
        });
      } catch (error) {
        compose.becomeDraft(sessionId, id);
        setSentWords((current) => withoutKey(current, id));
        toast.error("Failed to start the chat", {
          description: error instanceof Error ? error.message : String(error),
        });
        return;
      } finally {
        setStartingIds((current) => withoutId(current, id));
      }
      setDrafts((current) => current.filter((entry) => entry.id !== id));
      removeAsks(marked.map((ask) => ask.id));
      setArrived({ draftId: id, sessionId });
      // What the draft gathered becomes the chat's tabs, the pages and
      // folders as they stand, behind the window; the new-tab pages among
      // them were the band's own face and are not carried over, and a draft
      // that gathered nothing hands over nothing, so the chat opens with
      // no pane.
      const group = draftGroupOf(id);
      const own = windowTabs.allTabs.filter((tab) => tab.group === group);
      const homes = own.filter((tab) => isHomeTab(tab));
      for (const home of homes) {
        windowTabs.close(home.id);
      }
      if (homes.length === own.length) {
        windowTabs.dropGroup(group);
      } else {
        windowTabs.adoptGroup(group, sessionId, { show: false });
      }
    })();
  };
  return {
    arrivedId: arrived?.sessionId,
    closeDraft,
    deleteDraft,
    newDraft,
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

function withoutKey<T>(
  map: ReadonlyMap<string, T>,
  key: string,
): ReadonlyMap<string, T> {
  const next = new Map(map);
  next.delete(key);
  return next;
}
