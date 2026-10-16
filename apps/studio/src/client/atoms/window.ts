import { PANE_DEFAULT_SHARE } from "@/client/atoms/right-pane";
import {
  type FileSystemListColumn,
  type FileSystemGroupKey,
  type FileSystemSortState,
} from "@/client/components/extend/file-system";
import { type PromptInputDraft } from "@/client/components/prompt-input";
import { type ChatFilters, NO_FILTERS } from "@/client/components/window/chats";
import { type TabHistory as ScreenHistory, type TabId } from "@/shared/tabs";
import {
  type ChatId,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";
import { atom, type SetStateAction } from "jotai";
import { atomFamily } from "jotai/utils";
import { ulid } from "ulid";

import { keptAtom } from "@/client/lib/kept-state";
import { DRAFTS_KEY } from "@/shared/kept-state";

/**
 * What the chat column is narrowed to.
 *
 * Here rather than in the pane that reads it, because anything that opens a
 * brand new chat has to put the list back where that chat is visible: a
 * column standing in a topic or a place is a column the new chat is very
 * likely not in, and a button that appears to do nothing is a button someone
 * presses again.
 */
export const chatFiltersAtom = atom<ChatFilters>(NO_FILTERS);

/**
 * What a screen shows, in the terms the conversation is told it; see
 * `TabSurface.view`.
 */
export type ScreenView = Omit<
  SessionMessageDataPart.ViewContextDataPart,
  "page" | "url"
>;

/** A file or folder on this computer picked to go with a draft, by its path. */
export interface ChosenItem {
  kind: "file" | "folder";
  path: string;
}

/** A Finder's folder and what is selected in it, by host path. */
export interface FinderShown {
  folder: string;
  selected: ChosenItem[];
}

/**
 * A file or folder given to a draft's composer, by its path on disk: what of
 * the composer outlasts the app. Bytes pasted in with no file behind them
 * are written to the draft's own folder first, and kept by that path.
 */
export type DraftAttachment =
  | { kind: "file"; mimeType: string; name: string; path: string; size: number }
  | { kind: "folder"; path: string };

/**
 * A chat not yet started: its words and the topic it will be filed under.
 * What it has gathered (sites, files, folders) is its tab group, kept with
 * the window's tabs under the draft's group key; what its composer holds
 * besides the words is kept in memory beside it, and the part of that with
 * a place on disk in `attached`.
 */
export interface Draft {
  /** What the composer was given that has a place on disk, so it comes back after a relaunch. */
  attached?: DraftAttachment[];
  /**
   * The chat a reply is for. A chat may have several, ready to be sent one
   * after another, and the newest is the one in its box. Absent on a draft
   * that opens a chat of its own, which is what tells the two apart.
   */
  chatId?: ChatId;
  /**
   * Files and folders the person opened the draft on by name, from a menu or
   * a button over them: held for the chat whatever the window moves on to,
   * until the person leaves one out.
   */
  chosen?: ChosenItem[];
  createdAt: number;
  id: string;
  /**
   * The thing the draft was opened over, when the window stood in a place
   * with a tab up: that tab, by its group and id. A pointer rather than a
   * copy or a tab of the draft's own, so the draft says what the screen
   * already gives it and the chat is told about it as it starts. A folder,
   * file, or app's front on one of the window's own tabs is that tab, by its
   * id. A chat on screen is the chat, whether or not its pane is open: what
   * is in it is the chat's, so the draft names the chat and nothing in it.
   */
  included?:
    | { appTabId: TabId }
    | { chat: ChatId }
    | { group: string; tabId: string };
  /** The chips the person left out of the draft, by their keys (see `ContextItem`). */
  leftOut?: string[];
  topicId?: string;
  /**
   * Who settled the topic: the person, by picking or clearing one, or the
   * decision model, from what the draft says. Absent while neither has, which
   * is the only time a draft is filed on its own.
   */
  topicSource?: "chosen" | "suggested";
  updatedAt: number;
  words: string;
}

/** The group key a draft's tabs are kept under. */
export function draftGroupOf(draftId: string): string {
  return `draft:${draftId}`;
}

/** The draft a group key names, if it names one. */
export function draftOfGroup(group: string | undefined): string | undefined {
  return group?.startsWith("draft:") ? group.slice("draft:".length) : undefined;
}

/**
 * Every draft not yet started, newest last, kept across launches as a folder
 * each in the workspace's `drafts/`: a draft put away is still in Drafts, and
 * one whose folder is deleted is gone.
 */
export const draftsAtom = keptAtom<Draft[]>("drafts", DRAFTS_KEY, []);

/** How long a draft's words are left alone before its record is written. */
const DRAFT_WORDS_SETTLE_MS = 300;

/** Each draft's pending write of its words to its record. */
const draftWordsWrites = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * A draft's words: the one place they are typed into and read from, by the
 * composer, its bar, the Drafts list and the send alike. They start as the
 * record's (a draft made with words in it, or one kept past a launch), and
 * what is typed is written back to the record a beat later rather than on
 * every key: writing the record lays the whole window out again, transcripts
 * and all, and that on each keystroke is felt in the keys.
 */
export const draftWordsAtom = atomFamily((draftId: string) => {
  const typed = atom<null | string>(null);
  const words = atom(
    (get) =>
      get(typed) ??
      get(draftsAtom).find((draft) => draft.id === draftId)?.words ??
      "",
    (get, set, update: SetStateAction<string>) => {
      const next = typeof update === "function" ? update(get(words)) : update;
      set(typed, next);
      clearTimeout(draftWordsWrites.get(draftId));
      draftWordsWrites.set(
        draftId,
        setTimeout(() => {
          draftWordsWrites.delete(draftId);
          set(draftsAtom, (current) =>
            current.map((draft) =>
              draft.id === draftId && draft.words !== next
                ? { ...draft, updatedAt: Date.now(), words: next }
                : draft,
            ),
          );
        }, DRAFT_WORDS_SETTLE_MS),
      );
    },
  );
  return words;
});

/** Lets go of a draft's words, for a draft sent or thrown away. */
export function forgetDraftWords(draftId: string) {
  clearTimeout(draftWordsWrites.get(draftId));
  draftWordsWrites.delete(draftId);
  draftWordsAtom.remove(draftId);
}

/** Which draft each chat's box is writing into, by chat id: see {@link chatBoxDraftsAtom}. */
export type ChatBoxDrafts = Record<string, null | string>;

/**
 * Which draft each chat's box is writing into: the reply it took up, or null
 * where it took up none, which an emptied box and one whose reply has just
 * been sent both are. A chat not named here has taken nothing up yet, so its
 * box reads the newest of the chat's replies, which is what a chat opened for
 * the first time since a launch finds.
 *
 * Held rather than worked out from which reply is newest. A box that worked it
 * out answered differently the moment the draft it was writing into went:
 * emptying the box by hand deleted that draft, and the next words typed landed
 * in another reply the person had already written, over its words, with
 * nothing said and no way back.
 */
export const chatBoxDraftsAtom = atom<ChatBoxDrafts>({});

/**
 * The reply a chat's box is writing into, which is a draft of its own in
 * Drafts: the one it took up, or the newest of the chat's where it has taken
 * none up yet. Nothing at all for a box writing into none, where the next
 * words typed start a reply of their own.
 */
export function replyDraftOf(
  drafts: Draft[],
  boxDrafts: ChatBoxDrafts,
  chatId: ChatId,
): Draft | undefined {
  const writingInto = boxDrafts[chatId];
  if (writingInto === null) {
    return undefined;
  }
  return writingInto === undefined
    ? newestReplyOf(drafts, chatId)
    : drafts.find((draft) => draft.id === writingInto);
}

/** The newest of a chat's replies waiting, which is what a box that has taken none up reads. */
function newestReplyOf(drafts: Draft[], chatId: ChatId): Draft | undefined {
  return drafts
    .filter((draft) => draft.chatId === chatId)
    .reduce<Draft | undefined>(
      (newest, draft) =>
        newest === undefined || draft.updatedAt >= newest.updatedAt
          ? draft
          : newest,
      undefined,
    );
}

/**
 * A chat's replies waiting that its box is not writing into, newest first:
 * what the control over the box counts and offers. Every one of them where
 * the box is writing into none.
 */
export function otherRepliesOf(
  drafts: Draft[],
  boxDrafts: ChatBoxDrafts,
  chatId: ChatId,
): Draft[] {
  const inTheBox = replyDraftOf(drafts, boxDrafts, chatId);
  return drafts
    .filter((draft) => draft.chatId === chatId && draft.id !== inTheBox?.id)
    .toSorted((one, other) => other.updatedAt - one.updatedAt);
}

/**
 * The drafts being sent, which are not deleted for having no words: the box
 * empties on submit, a beat before the send lands, and a send that fails
 * puts the words back into the draft they came from.
 */
const draftsBeingSent = new Set<string>();

/**
 * Holds a draft through a send: the words it is being sent with are left
 * alone, and it is not deleted for being empty. Answers with what to call
 * when the send has settled.
 */
export function holdDraftWhileSending(draftId: string): () => void {
  draftsBeingSent.add(draftId);
  return () => {
    draftsBeingSent.delete(draftId);
  };
}

/**
 * The words in a chat's own box: a draft of the chat's in Drafts, like the
 * draft a new chat is written in, so a reply left half-typed is on disk
 * where the person can find it, survives a relaunch, and can be read on
 * another device.
 *
 * Nothing is written while someone is typing: the draft is made when the
 * typing settles, and the id is minted then, so no draft is ever written
 * under an id a sent one had. A box emptied by hand takes its draft with it,
 * unless something was pasted or attached into it.
 */
export const chatDraftWordsAtom = atomFamily((chatId: ChatId) => {
  const typed = atom<null | string>(null);
  const words = atom(
    (get) =>
      get(typed) ??
      replyDraftOf(get(draftsAtom), get(chatBoxDraftsAtom), chatId)?.words ??
      "",
    (get, set, update: SetStateAction<string>) => {
      const next = typeof update === "function" ? update(get(words)) : update;
      set(typed, next);
      const key = boxWriteKey(chatId);
      clearTimeout(draftWordsWrites.get(key));
      draftWordsWrites.set(
        key,
        setTimeout(() => {
          set(keepChatBoxAtom, { chatId, words: next });
        }, DRAFT_WORDS_SETTLE_MS),
      );
    },
  );
  return words;
});

/** Where a chat's box keeps the write it has pending, among {@link draftWordsWrites}. */
function boxWriteKey(chatId: ChatId): string {
  return `chat:${chatId}`;
}

/** Lets go of a chat's box, for a reply sent: its next words start a new draft. */
export function forgetChatDraftWords(chatId: ChatId) {
  clearTimeout(draftWordsWrites.get(boxWriteKey(chatId)));
  draftWordsWrites.delete(boxWriteKey(chatId));
  chatDraftWordsAtom.remove(chatId);
}

/**
 * A reply draft for a chat's box, made now and written into from here: for
 * words typed into a box that was writing into none, and for a paste, which
 * is on disk the moment it arrives and so needs a draft of its own before any
 * words have settled into one. Answers with its id.
 */
export const makeReplyDraftAtom = atom(
  null,
  (
    _get,
    set,
    { chatId, words = "" }: { chatId: ChatId; words?: string },
  ): string => {
    const now = Date.now();
    const made: Draft = {
      chatId,
      createdAt: now,
      id: ulid(),
      updatedAt: now,
      words,
    };
    set(draftsAtom, (current) => [...current, made]);
    set(chatBoxDraftsAtom, (current) => ({ ...current, [chatId]: made.id }));
    return made.id;
  },
);

/**
 * Writes what is in a chat's box into the draft it is writing into, and says
 * which draft that is from here on. A draft is made where the box was writing
 * into none and there is something to keep, and taken away where the box was
 * emptied by hand and nothing was pasted or attached into it: an emptied box
 * is writing into nothing, so the next words typed start a reply of their own
 * instead of landing in another one waiting.
 */
const keepChatBoxAtom = atom(
  null,
  (get, set, { chatId, words }: { chatId: ChatId; words: string }) => {
    const key = boxWriteKey(chatId);
    clearTimeout(draftWordsWrites.get(key));
    draftWordsWrites.delete(key);
    const draft = replyDraftOf(get(draftsAtom), get(chatBoxDraftsAtom), chatId);
    // Words in a box writing into no draft are a reply of their own, and so
    // are words in a box whose draft is on its way to the chat: the box
    // empties on submit, a beat before the send lands, and that draft keeps
    // the words it is being sent with, so a send the workspace rejects still
    // has them and so does the next launch after a crash.
    if (!draft || draftsBeingSent.has(draft.id)) {
      if (words.trim() !== "") {
        set(makeReplyDraftAtom, { chatId, words });
      }
      return;
    }
    if (words.trim() === "" && (draft.attached ?? []).length === 0) {
      set(draftsAtom, (current) =>
        current.filter((entry) => entry.id !== draft.id),
      );
      set(chatBoxDraftsAtom, (current) => ({ ...current, [chatId]: null }));
      return;
    }
    if (draft.words !== words) {
      set(draftsAtom, (current) =>
        current.map((entry) =>
          entry.id === draft.id
            ? { ...entry, updatedAt: Date.now(), words }
            : entry,
        ),
      );
    }
    set(chatBoxDraftsAtom, (current) =>
      current[chatId] === draft.id
        ? current
        : { ...current, [chatId]: draft.id },
    );
  },
);

/**
 * The reply a chat has just sent: its draft goes, because the message naming
 * it is written, and the box is writing into nothing from here, so the next
 * words typed start a reply of their own rather than landing in one of the
 * replies still waiting. The box lets go of the words it was emptied of as
 * well, unless the person started another reply in it while the send was in
 * flight: those words are that reply's.
 */
export const replySentAtom = atom(
  null,
  (get, set, { chatId, draftId }: { chatId: ChatId; draftId: string }) => {
    set(draftsAtom, (current) =>
      current.filter((entry) => entry.id !== draftId),
    );
    const writingInto = get(chatBoxDraftsAtom)[chatId];
    if (writingInto === draftId || writingInto === undefined) {
      set(chatBoxDraftsAtom, (current) => ({ ...current, [chatId]: null }));
      forgetChatDraftWords(chatId);
    }
  },
);

/**
 * Puts one of a chat's waiting replies in its box: the box writes into that
 * draft from here, and the one picked is stamped now, so a launch, which
 * reads the newest, finds in the box the reply the person last had there.
 *
 * Answers with the draft now in the box, because the composer has to be
 * given its words and what was attached to it: the document in the box is
 * the editor's own, and nothing here can write it.
 */
export const swapInReplyDraftAtom = atom(
  null,
  (
    get,
    set,
    { chatId, draftId }: { chatId: ChatId; draftId: string },
  ): Draft | undefined => {
    const leaving = replyDraftOf(
      get(draftsAtom),
      get(chatBoxDraftsAtom),
      chatId,
    );
    if (leaving?.id === draftId) {
      return leaving;
    }
    // Read while the box is still the leaving draft's, and written to that
    // draft below. The write that was pending for it is dropped here rather
    // than left to the box's own setter further down: what must not happen
    // is a write made against the old box landing a beat after the swap.
    const words = get(chatDraftWordsAtom(chatId));
    const key = boxWriteKey(chatId);
    clearTimeout(draftWordsWrites.get(key));
    draftWordsWrites.delete(key);
    set(draftsAtom, (current) =>
      current.map((draft) => {
        if (draft.id === draftId) {
          return { ...draft, updatedAt: Date.now() };
        }
        // The one leaving keeps the stamp it had: stamped now as well, it
        // would be the newest and a launch would find it in the box instead
        // of the reply just picked.
        return draft.id === leaving?.id && draft.words !== words
          ? { ...draft, words }
          : draft;
      }),
    );
    // Words typed into a box that was writing into no draft are the person's
    // too, so they stay as a reply of their own rather than going with the
    // one picked.
    if (!leaving && words.trim() !== "") {
      set(makeReplyDraftAtom, { chatId, words });
    }
    const picked = get(draftsAtom).find((draft) => draft.id === draftId);
    if (picked) {
      set(chatBoxDraftsAtom, (current) => ({
        ...current,
        [chatId]: picked.id,
      }));
      // The box reads what was last typed in it before it reads the draft,
      // so those words are replaced rather than left standing over the reply
      // just swapped in.
      set(chatDraftWordsAtom(chatId), picked.words);
    }
    return picked;
  },
);

/**
 * What each draft's composer held besides its words when it was last put
 * away, by draft id: the files and folders it was given, restored when the
 * draft comes back up. In memory only, since bytes do not belong in storage.
 */
export const draftSnapshotsAtom = atom<Record<string, PromptInputDraft>>({});

/**
 * One window along the foot: a draft being written, or a chat floating in
 * its small view, and how the window stands. A chat's entry remembers the
 * draft it grew from, so the window that was the draft is the window that
 * is the chat, with no arrival between them.
 */
export type ComposeEntry = { placement: ComposePlacement } & (
  | { draftId: string; kind: "draft" }
  | { chatId: ChatId; fromDraft?: string; kind: "chat" }
);

/** How a window stands: docked along the window's foot, grown to fill the window, or put down to a bar along the foot. */
export type ComposePlacement = "bar" | "docked" | "expanded";

/** The group key of what a window shows: the draft's tabs, or the chat's. */
export function composeKeyOf(entry: ComposeEntry): string {
  return entry.kind === "draft" ? draftGroupOf(entry.draftId) : entry.chatId;
}

/** The chats up in a window of their own over the row: docked or grown, not put down to a bar. */
export function chatsOutOf(entries: ComposeEntry[]): Set<string> {
  return new Set(
    entries.flatMap((entry) =>
      entry.kind === "chat" && entry.placement !== "bar" ? [entry.chatId] : [],
    ),
  );
}

/**
 * The windows floating over the row, the way a mail client keeps several
 * compose windows along its foot, oldest first: the newest stands at the
 * right, and the ones there is no room for are not drawn. The drafts being
 * written and the chats in their small views share the row. Kept across
 * launches, so what was floating when the app quit floats again; the drafts
 * themselves are in `draftsAtom`.
 */
export const composeAtom = keptAtom<ComposeEntry[]>("layout", "compose.v2", []);

/** The places the rail at the window's edge switches between: the chat, the files, the browser, and the apps. */
export type AppPlace = "apps" | "browser" | "chat" | "files";

/**
 * The chat a tab last had open, so Chat in the rail takes a tab back to it.
 * Null for the inbox alone.
 */
export const chatGroupAtom = keptAtom<null | string>(
  "layout",
  "chat-group.v2",
  null,
);

/**
 * Whether the inbox column is shown. Put away, a chat and its tabs have
 * the window to themselves; it comes back on its own when nothing is left
 * on screen without it.
 */
export const inboxOpenAtom = keptAtom<boolean>("layout", "inbox-open.v1", true);

/**
 * Whether each group's pane is open, by the chat's id or the draft's
 * key: the tabs beside the conversation, put away and brought back
 * by the toggle over it. A group not named here has its pane open, so a
 * chat whose agent opened something shows it on arrival.
 */
export const paneOpenByGroupAtom = keptAtom<Record<string, boolean>>(
  "layout",
  "pane-open.v2",
  {},
);

/** The pane's share of the row beside the conversation, dragged at its edge; one share for every chat. */
export const paneShareAtom = keptAtom<number>(
  "view",
  "pane-share.v1",
  PANE_DEFAULT_SHARE,
);

/** A tab of the window's browser: a browser session of the window's own, under `WINDOW_ID`. */
export interface BrowserTab {
  /** The page's icon, as the page last announced it. */
  favicon?: string;
  /** The session id, which is the half of the target id a task can be handed. */
  id: string;
  openedAt: number;
  /** The address it was opened at, which a pin asks for again; the page may have moved on from it. */
  openedUrl?: string;
  /** The page's title, as it last announced it; kept so a tab not yet shown still says what it is. */
  title?: string;
  /** The last page it showed, opened again when the tab comes back. */
  url?: string;
}

/** A file the window can open in a tab: where it is on the computer, which is the tab's identity. */
export interface FileTab {
  hostPath: string;
  name: string;
}

/**
 * A tab of the window. A page is a browser session of the window's own,
 * drawn by a guest the pool holds; a screen is anything else the product
 * shows (a folder, a file, a task, the apps, a new tab), addressed by the
 * route it is at, so navigating inside it changes the tab and not the row.
 */
export type TabVisit =
  | (BrowserTab & { kind: "page" })
  | {
      /** Where the screen's own router has been, and where along it the tab stands; one address until it has moved. */
      history?: ScreenHistory;
      href: string;
      id: string;
      kind: "screen";
    };

export type WindowTab = TabHistory & TabVisit;

/**
 * Where a tab has been, and whether it was opened by something else.
 *
 * History belongs to a tab rather than to the window: back never moves you to
 * a different tab, which is the thing that makes a strip of them readable. A
 * page keeps its guest's native history and a screen its router's; past and
 * future retain visits across the boundary between screens and pages.
 */
interface TabHistory {
  future?: TabVisit[];
  /**
   * The chat this tab belongs to, by its id, or the draft's key:
   * what was opened while the chat was on screen stays with the chat.
   */
  group?: string;
  /**
   * True when this tab was opened from another one rather than by the user
   * asking for a tab. Back from the start of such a tab closes it, which is
   * what a tab opened to show one thing should do when you are done with it.
   */
  isOpened?: boolean;
  /** Visits across the screen/browser boundary; each guest keeps its native history. */
  past?: TabVisit[];
  /**
   * The strip key of the tab this one took the place of, so the strip sees
   * one tab changing rather than one leaving and another arriving: a new tab
   * that became a page, a page that went back to being a new tab.
   */
  stripKey?: string;
}

export function originOf(url: string | undefined): string | undefined {
  if (!url) {
    return;
  }
  try {
    return new URL(url).origin;
  } catch {
    return;
  }
}

/** The address a new tab opens at: the page with the box that reaches everything. */
export const NEW_TAB_HREF = "/new-tab";

/** The web's starting view beside a chat: an address field over the sites kept and lately seen. */
export const BROWSER_HREF = "/browser";

/** The address of the apps: the tab the Apps place opens on. */
export const APPS_HREF = "/apps";

/**
 * The address a group's new tab opens at: the page that reaches everything
 * for a draft, and the web's starting view for a chat, whose tabs are its
 * browsers.
 */
export function newTabHrefOf(group: string | undefined): string {
  return draftOfGroup(group) === undefined ? BROWSER_HREF : NEW_TAB_HREF;
}

/** The route a chat's screen is at, followed by the chat's id. */
export const CHATS_HREF = "/chats";

export const SIDEBAR_WIDTH_MIN = 320;
/** The inbox's widest: a list to pick a chat from, never a page of its own, so the room past this goes to the chat beside it. */
export const SIDEBAR_WIDTH_MAX = 440;

const storedInboxWidthAtom = keptAtom<number>(
  "view",
  "inbox-width.v1",
  SIDEBAR_WIDTH_MIN,
);

/** The inbox column's width in CSS px, dragged by its right edge, and read within its widest whatever was stored. */
export const inboxWidthAtom = atom(
  (get) => Math.min(get(storedInboxWidthAtom), SIDEBAR_WIDTH_MAX),
  (_get, set, width: number) => {
    set(storedInboxWidthAtom, width);
  },
);

/**
 * The layout last chosen anywhere: what a folder with no layout of its own
 * opens in when arrived at directly, a new tab's first folder among them.
 * Walking from folder to folder keeps whatever layout is on screen instead,
 * the way a Finder window does.
 */
export const computerViewAtom = keptAtom<
  "columns" | "gallery" | "icons" | "list"
>("view", "computer-view.v1", "columns");

/** Off by default, the way every file browser starts: a folder of dotfiles is a folder whose own contents are harder to find. */
export const computerHiddenFilesAtom = keptAtom<boolean>(
  "view",
  "computer-hidden-files.v1",
  false,
);

/**
 * The layout, order and grouping each folder was last set to by hand, by
 * where it is on the computer, the way the Finder keeps them with the
 * folder. The order and grouping hold however the folder is reached; the
 * layout only when it is arrived at directly, since walking keeps the tab's
 * own. All are kept whenever any is set, and walking into a folder sets
 * none. The recents are kept under their root.
 */
export const computerFolderViewsAtom = keptAtom<
  Record<string, ComputerFolderView>
>("view", "computer-folder-views.v1", {});

export interface ComputerFolderView {
  /** Absent for a folder last set before grouping, which is ungrouped. */
  group?: FileSystemGroupKey | null;
  sort: FileSystemSortState;
  view: "columns" | "gallery" | "icons" | "list";
}

/**
 * Whether a file tab shows the tree beside its document. One answer for
 * every file tab: the tree is a way of working, not a property of a file.
 */
export const fileTreeOpenAtom = keptAtom<boolean>(
  "view",
  "file-tree-open.v1",
  true,
);

/**
 * Whether the Finder shows its sidebar of places beside the folder, where the
 * tab is wide enough to hold both. One answer for every Finder, the way the
 * tree beside a file is. A narrow tab lays the places over the folder only
 * while asked for, whatever this says.
 */
export const finderPlacesOpenAtom = keptAtom<boolean>(
  "view",
  "finder-places-open.v1",
  true,
);

/** How wide the Finder's sidebar is, in CSS px, dragged at its right edge. One width for every Finder. */
export const finderPlacesWidthAtom = keptAtom<number>(
  "view",
  "finder-places-width.v1",
  176,
);

/** How wide the tree beside a file is, in CSS px, dragged at its right edge. One width for every file tab, as the tree is one way of working. */
export const fileTreeWidthAtom = keptAtom<number>(
  "view",
  "file-tree-width.v1",
  240,
);

/** How wide a folder is beside a file open in it, in CSS px, dragged at its right edge. One width for every view. */
export const finderBesideWidthAtom = keptAtom<number>(
  "view",
  "finder-beside-width.v1",
  300,
);

/**
 * The list view's columns beside Name, picked from its header's menu. One set
 * for every folder, the way the Finder's own defaults are one set.
 */
export const computerListColumnsAtom = keptAtom<FileSystemListColumn[]>(
  "view",
  "computer-list-columns.v1",
  ["updatedAt", "size", "kind"],
);

/** How wide the list view's columns beside Name are, in CSS px, dragged at their headers; a column left out is at its default. */
export const computerListColumnWidthsAtom = keptAtom<
  Partial<Record<FileSystemListColumn, number>>
>("view", "computer-list-column-widths.v1", {});

/** How wide the columns view's columns are, in CSS px, dragged at any column's right edge. */
export const computerColumnWidthAtom = keptAtom<number>(
  "view",
  "computer-column-width.v1",
  240,
);

/** A page the user kept, shown on the browser's starting view. */
export interface Bookmark {
  id: string;
  title: string;
  url: string;
}

export const bookmarksAtom = keptAtom<Bookmark[]>(
  "bookmarks",
  "bookmarks.v1",
  [],
);
