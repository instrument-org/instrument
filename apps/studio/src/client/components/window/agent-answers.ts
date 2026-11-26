import { type BookmarkOp } from "@/shared/bookmarks";
import {
  type ChatState,
  type LayoutTab,
  type ListedGroup,
  type ListFacts,
  type PageMark,
  type WindowTabAction,
} from "@instrument-org/workspace/client";

import { type ChatDot } from "./chat-mark";
import { type LineTone, type RowLines } from "./row-lines";
import { type GroupOwn } from "./tab-model";
import { type TabOp } from "./tab-ops";

/**
 * How the agent answers one thing the person can do or see: by what covers
 * it (one anchor, or several that do between them), by why it is not the
 * agent's (`not`), or by what is missing for a person's action no agent
 * command covers yet (`gap`).
 *
 * Each table here is checked against the type it answers for, so a new tab
 * change, group field, bookmark change or row fact, and a renamed agent
 * action or list field, fails to build until its row is answered.
 */
export type AgentAnswer<Anchor extends string> =
  | Anchor
  | readonly [Anchor, ...Anchor[]]
  | { gap: string }
  | { not: string };

/** Every change a window can make: a tab change, a group's own field, a bookmark change. */
type WindowChange =
  | TabOp
  | `bookmark.${BookmarkOp["type"]}`
  | `group.${keyof GroupOwn}`;

const FOLLOWING = {
  not: "the window following what a page, a router or a chat did, not a person's action",
} as const;

const AGENTS_OWN = {
  not: "where a task's pages or an agent's own land, which the agent asks for by opening them",
} as const;

/**
 * Every change a window can make to its tabs, groups and bookmarks, answered
 * by the agent's window action (`WindowTabAction["kind"]`) that makes it.
 */
export const WINDOW_CHANGE_ANSWERS = {
  addPages: AGENTS_OWN,
  // Tab by tab: History reopens a side whole.
  closeSide: "close",
  closeTab: "close",
  dropGroup: "closeGroup",
  fileTabWalked: FOLLOWING,
  focusSide: {
    not: "the keyboard is the person's: an agent shows a tab and leaves the keyboard where it is",
  },
  handOverBeside: "handOver",
  joinSides: "joinSides",
  markOpenedBy: FOLLOWING,
  markPrompted: FOLLOWING,
  markSignIn: FOLLOWING,
  moveTabTo: "moveTabs",
  moveToGroup: "moveTabs",
  navigateScreenUp: "replace",
  openBeside: "open",
  openInGroup: "open",
  openOrFocusScreen: "open",
  openPage: "open",
  openPageBesideChat: "open",
  openPageTab: "open",
  openScreen: "open",
  openScreenBesideChat: "open",
  pageBecameDownload: FOLLOWING,
  pageBecomesFile: FOLLOWING,
  pageNavigated: FOLLOWING,
  pageNavigatedUp: FOLLOWING,
  pageTakesOver: FOLLOWING,
  patchPage: FOLLOWING,
  pickTab: "show",
  putUpBack: { not: "puts tabs back after a canceled drag" },
  raiseTab: "show",
  reopenSide: "reopenClosed",
  reopenTab: "reopenClosed",
  reorderGroup: "moveTabs",
  replaceTab: "replace",
  restoreGroup: "reopenClosed",
  screenMoved: FOLLOWING,
  selectShowing: "show",
  selectTab: "show",
  startedOver: FOLLOWING,
  stepTrail: "step",
  stepVisit: "step",
  tabToScreen: "replace",
  withGroupOwn: { not: "each field it sets has its own row, group.<field>" },

  "group.chatSide": FOLLOWING,
  "group.lead": FOLLOWING,
  "group.pinned": "pinGroup",
  "group.project": {
    not: "set as a group is made, from the project the sidebar is in; a person moves a chat to a project (chats.project), never a group",
  },
  "group.share": {
    gap: "how wide each side of a split is, which the person drags",
  },
  "group.shownAt": FOLLOWING,

  "bookmark.add": "addBookmark",
  "bookmark.addFolder": "changeBookmarks",
  "bookmark.move": "changeBookmarks",
  "bookmark.remove": "changeBookmarks",
  "bookmark.rename": "changeBookmarks",
  "bookmark.setUrl": "changeBookmarks",
} as const satisfies Record<WindowChange, AgentAnswer<WindowTabAction["kind"]>>;

/**
 * What a sidebar row shows: the fields of its lines (`RowLines`) but the
 * line itself, its line in each tone, and the dot on a chat's mark.
 */
type RowFact =
  | Exclude<keyof RowLines, "line" | "tone">
  | `dot.${ChatDot}`
  | `line.${LineTone}`;

/** Where `instrument window list` says it: a field of a group, a tab, a page's mark, a chat's state, or the list's other facts. */
type ListField =
  | `chat.${keyof ChatState}`
  | `facts.${keyof ListFacts}`
  | `group.${keyof ListedGroup}`
  | `mark.${keyof PageMark}`
  | `tab.${keyof LayoutTab}`;

/** What a sidebar row shows, answered by where `instrument window list` says the same. */
export const ROW_FACT_ANSWERS = {
  "dot.unread": "chat.unread",
  "dot.working": "chat.working",
  "line.ask": ["chat.status", "chat.latest"],
  "line.draft": "group.drafts",
  // A task tab's Stopped is the one fail the list leaves out: it names a
  // task only while it works (`facts.steps`).
  "line.fail": ["chat.status", "mark.failed"],
  "line.news": ["chat.latest", "chat.unread"],
  "line.quiet": ["tab.address", "chat.latest", "chat.stopped_for"],
  "line.work": ["chat.latest", "facts.steps"],
  strong: "chat.unread",
  title: "group.name",
  trail: "tab.address",
} as const satisfies Record<RowFact, AgentAnswer<ListField>>;
