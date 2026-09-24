import { featuresAtom } from "@/client/atoms/features";
import {
  type AppPlace,
  type ChosenItem,
  type Draft,
  draftGroupOf,
  draftsAtom,
  draftSnapshotsAtom,
  NEW_TAB_HREF,
  placeGroupOf,
  threadFiltersAtom,
  type WindowTab,
} from "@/client/atoms/orchestrator";
import { type useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import {
  type SessionMessageDataPart,
  type StoreId,
} from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import ms from "ms";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ulid } from "ulid";

import { type DraftSend } from "./compose-window";
import { computerTabOf } from "./file-tabs";
import { NO_FILTERS, type Topic } from "./threads";
import { type useCompose } from "./use-compose";
import {
  isFreshTab,
  isHomeTab,
  parseHref,
  type useWindowTabs,
} from "./window-tabs";

/** How long a thread just started from a draft is marked as arriving in the inbox; the row's own motion is shorter. */
const THREAD_ARRIVAL_MS = ms("3 seconds");

/**
 * A draft's life around its window: made and brought up along the row's
 * foot, put away with its words kept or thrown away with nothing written,
 * and started as the thread it is for. The windows themselves are the
 * compose surface's; this is what happens to a draft on the way in and out
 * of one.
 */
export function useDrafts({
  compose,
  draftContext,
  ids,
  place,
  saveDefaultModelURI,
  toChat,
  topics,
  windowTabs,
}: {
  /** The windows along the row's foot, which a draft is written in. */
  compose: ReturnType<typeof useCompose>;
  /** What a draft's window has up, read as its thread starts. */
  draftContext: (
    draftId: string,
  ) => Promise<SessionMessageDataPart.ViewContextDataPart | undefined>;
  /** The orchestrator, once it exists; no thread starts before it does. */
  ids: RPCOutput["workspace"]["orchestrator"]["ensure"] | undefined;
  /** Where the rail has the window standing: what a draft is opened over, and where its thread lands. */
  place: AppPlace;
  /** Keeps the model a thread was started with as the one the next draft opens with. */
  saveDefaultModelURI: ReturnType<typeof useDefaultModelURI>[2];
  /** Puts the window on the chat, for a thread coming on screen from wherever it stands. */
  toChat: () => void;
  /** The orchestrator's topics, for the one the inbox stands in. */
  topics: Topic[];
  windowTabs: ReturnType<typeof useWindowTabs>;
}) {
  const isChat = place === "chat";
  const features = useAtomValue(featuresAtom);
  const [drafts, setDrafts] = useAtom(draftsAtom);
  const setDraftSnapshots = useSetAtom(draftSnapshotsAtom);
  const [threadFilters, setThreadFilters] = useAtom(threadFiltersAtom);
  const createMessage = useMutation(
    rpcClient.workspace.message.create.mutationOptions(),
  );
  // The drafts whose first messages are on their way, by id.
  const [startingIds, setStartingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // The thread a draft just became, for as long as its row's arrival lasts.
  const [arrivedId, setArrivedId] = useState<StoreId.Session>();
  useEffect(() => {
    if (arrivedId === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      setArrivedId(undefined);
    }, THREAD_ARRIVAL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [arrivedId]);
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
    // What the draft is opened over: the tab the place has up, when the
    // window stands in a place and that tab is something the conversation
    // can be told about. A place's own fresh tab is the place, not a thing.
    const overGroup =
      place === "chat" || place === "home" ? undefined : placeGroupOf(place);
    const over =
      overGroup === undefined ? undefined : windowTabs.tabUpIn(overGroup);
    const included =
      overGroup !== undefined && over !== undefined && isIncludable(over)
        ? { group: overGroup, tabId: over.id }
        : undefined;
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
  };
  /**
   * New, from the rail or its chord, or a button handing over a line: a
   * draft filed under the topic the inbox stands in while it stands in one,
   * with the window put on the chat, which is where a draft is written.
   */
  const newDraft = (words?: string, chosen?: ChosenItem[]) => {
    startDraft(
      isChat && threadFilters.topics.length === 1
        ? topics.find((topic) => topic.id === threadFilters.topics[0])?.id
        : undefined,
      typeof words === "string" ? words : "",
      chosen,
    );
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
  /** Throws a draft away: its window, its record, what its composer held, and its tabs. */
  const deleteDraft = (id: string) => {
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
   * Starts the thread the draft is for: what its composer sends (the words,
   * the files, the folders, the model) and its topic as the first message,
   * with what its band shows as the context; then what the draft gathered
   * becomes the thread's tabs exactly as they are. Started from Chat, the
   * thread comes on screen beside the inbox and the window goes; started
   * from a place (or from Chat with the flag on), the window becomes the
   * thread's small view in the same corner, and the place is left as it is.
   */
  const startThread = (id: string, send: DraftSend) => {
    const draft = drafts.find((entry) => entry.id === id);
    if (!draft || !ids || startingIds.has(id)) {
      return;
    }
    // Read as the thread starts: where the window stood when the arrow was
    // pressed is where the thread is asked for.
    const floats = !isChat || features.float_every_draft;
    setStartingIds((current) => new Set(current).add(id));
    // The model chosen for the thread is the one the next draft opens with.
    saveDefaultModelURI(send.modelURI);
    void (async () => {
      let viewing: SessionMessageDataPart.ViewContextDataPart | undefined;
      try {
        viewing = await draftContext(id);
      } catch {
        // A context that cannot be gathered is a thread told less, not a
        // thread that never starts: the send goes on without it.
      }
      // Each send settles on its own: the mutation observer follows only the
      // latest call, so callbacks handed to it would be lost for a draft sent
      // while another was still on its way.
      let sessionId: StoreId.Session;
      try {
        ({ sessionId } = await createMessage.mutateAsync({
          files: send.files,
          folders: send.folders,
          id: ids.taskId,
          modelURI: send.modelURI,
          output: send.output,
          prompt: send.prompt,
          ...(draft.topicId ? { topics: [draft.topicId] } : {}),
          viewing,
        }));
      } catch (error) {
        toast.error("Failed to start the thread", {
          description: error instanceof Error ? error.message : String(error),
        });
        return;
      } finally {
        setStartingIds((current) => withoutId(current, id));
      }
      setDrafts((current) => current.filter((entry) => entry.id !== id));
      // What the draft gathered becomes the thread's tabs, the pages
      // and folders as they stand; the new-tab pages among them were
      // the band's own face and are not carried over, and a draft that
      // gathered nothing hands over nothing, so the thread opens with
      // no pane.
      const group = draftGroupOf(id);
      const own = windowTabs.allTabs.filter((tab) => tab.group === group);
      const homes = own.filter((tab) => isHomeTab(tab));
      for (const home of homes) {
        windowTabs.close(home.id);
      }
      if (floats) {
        // The window stays and becomes the thread's; the tabs move
        // behind it, and nothing on screen changes.
        compose.becomeThread(id, sessionId);
        if (homes.length === own.length) {
          windowTabs.dropGroup(group);
        } else {
          windowTabs.adoptGroup(group, sessionId, { show: false });
        }
        return;
      }
      compose.remove(group);
      setArrivedId(sessionId);
      if (homes.length === own.length) {
        windowTabs.dropGroup(group);
        windowTabs.showThread(sessionId);
      } else {
        windowTabs.adoptGroup(group, sessionId);
      }
      // The thread is on the chat, whatever place the draft was
      // written over.
      toChat();
      // A list narrowed to a topic or a place is a list the new thread
      // is very likely not in, so the narrowing goes.
      setThreadFilters(NO_FILTERS);
    })();
  };
  return {
    arrivedId,
    closeDraft,
    deleteDraft,
    newDraft,
    showDraft,
    startingIds,
    startThread,
  };
}

/**
 * Whether a tab is something a draft opened over it can carry to its thread:
 * a page, a file or folder on the computer, or an app's front. A place's own
 * fresh tab is the place rather than a thing in it, and the screens with no
 * words for the conversation are left out.
 */
function isIncludable(tab: WindowTab): boolean {
  if (isFreshTab(tab)) {
    return false;
  }
  if (tab.kind === "page") {
    return true;
  }
  return (
    computerTabOf(tab.href) !== undefined ||
    parseHref(tab.href).pathname.startsWith("/orchestrator/apps/")
  );
}

function withoutId(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(ids);
  next.delete(id);
  return next;
}
