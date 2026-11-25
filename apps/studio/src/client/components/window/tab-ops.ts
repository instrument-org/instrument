import { type BrowserTab, type WindowTab } from "@/client/atoms/window";
import { type ChatId } from "@instrument-org/workspace/client";

import {
  type BesideAsk,
  handOverBesideChat,
  openBesideChat,
  previousOpenedIn,
} from "./beside-chat";
import {
  addPages,
  addScreen,
  closeSide,
  closeTab,
  dropGroup,
  fileTabWalked,
  focusSide,
  joinSides,
  markOpenedBy,
  markPrompted,
  markSignIn,
  moveTabTo,
  moveToGroup,
  navigateScreen,
  openingFrom,
  openInGroup,
  openOrFocusScreen,
  openPage,
  pageBecameDownload,
  pageBecomesFile,
  pageNavigated,
  pageTakesOver,
  patchPage,
  pickTab,
  type Placing,
  putUpBack,
  raiseTab,
  reopenSide,
  reopenTab,
  reorderGroup,
  replaceTab,
  restoreGroup,
  screenMoved,
  selectedTabIn,
  selectTab,
  startedOver,
  stepTrail,
  stepVisit,
  tabShowingIn,
  tabToScreen,
  type WindowTabs,
  withChatSides,
  withGroupOwn,
} from "./tab-model";
import { type Opening } from "./tab-openers";

/**
 * Every change asked of the tabs, by name, with what it needs as plain
 * data: an id it makes and the time it reads are made by whoever asks, and
 * handed in. So a change means the same wherever it is applied, and applied
 * again over tabs that changed under it, and whoever keeps the tabs can
 * apply the changes of several windows one after another, in the order they
 * arrive.
 *
 * What is true only of the window asking goes in beside the change: the
 * group it has on screen. Each answers the tabs after it, and what the
 * asker wants to know of how it went.
 */

/** What a change is applied with that is the asking window's own. */
export interface TabOpContext {
  /** The group the window has on screen, or none. */
  onScreen: string | undefined;
}

interface Outcome<T> {
  state: WindowTabs;
  value: T;
}

/** A change of the tab model's that needs nothing of the window asking and answers nothing. */
const plain =
  <A extends unknown[]>(
    change: (state: WindowTabs, ...args: A) => WindowTabs,
  ) =>
  (
    state: WindowTabs,
    _context: TabOpContext,
    ...args: A
  ): Outcome<undefined> => ({
    state: change(state, ...args),
    value: undefined,
  });

const unchanged = <T>(state: WindowTabs, value: T): Outcome<T> => ({
  state,
  value,
});

export const TAB_OPS = {
  addPages: plain(addPages),
  closeSide: plain(closeSide),
  closeTab: plain(closeTab),
  dropGroup: plain(dropGroup),
  fileTabWalked: plain(fileTabWalked),
  focusSide: plain(focusSide),
  joinSides: plain(joinSides),
  markOpenedBy: plain(markOpenedBy),
  markPrompted: plain(markPrompted),
  markSignIn: plain(markSignIn),
  moveTabTo: plain(moveTabTo),
  moveToGroup: plain(moveToGroup),
  openInGroup: plain(openInGroup),
  pageBecameDownload: plain(pageBecameDownload),
  pageBecomesFile: plain(pageBecomesFile),
  pageNavigated: plain(pageNavigated),
  pageTakesOver: plain(pageTakesOver),
  patchPage: plain(patchPage),
  pickTab: plain(pickTab),
  putUpBack: plain(putUpBack),
  raiseTab: plain(raiseTab),
  reopenSide: plain(reopenSide),
  reopenTab: plain(reopenTab),
  reorderGroup: plain(reorderGroup),
  replaceTab: plain(replaceTab),
  restoreGroup: plain(restoreGroup),
  screenMoved: plain(screenMoved),
  selectTab: plain(selectTab),
  startedOver: plain(startedOver),
  tabToScreen: plain(tabToScreen),
  withGroupOwn: plain(withGroupOwn),

  /** A file a chat's reply handed over, beside the chat's tab (`handOverBesideChat`); nothing for a chat's tab no group has. */
  handOverBeside: (
    state: WindowTabs,
    _context: TabOpContext,
    ask: { chatTab: string; href: string; id: string; openedBy: ChatId },
  ): Outcome<undefined | { front: boolean; id: string; isNew: boolean }> => {
    if (!state.tabs.some((tab) => tab.id === ask.chatTab && tab.group)) {
      return unchanged(state, undefined);
    }
    const placed = handOverBesideChat(state, ask);
    return {
      state: placed.state,
      value: { front: placed.front, id: placed.id, isNew: placed.isNew },
    };
  },

  /** The tab the group on screen has up goes to a screen, in place (`navigateScreen`). */
  navigateScreenUp: (
    state: WindowTabs,
    { onScreen }: TabOpContext,
    to: { href: string; id: string },
  ): Outcome<undefined> =>
    unchanged(
      onScreen === undefined
        ? state
        : navigateScreen(state, { group: onScreen, ...to }),
      undefined,
    ),

  /**
   * A screen beside what the group on screen has up, right after the tab it
   * was opened from, or at the strip's end. Answers its tab, or nothing with
   * no group on screen.
   */
  openBeside: (
    state: WindowTabs,
    { onScreen }: TabOpContext,
    ask: {
      atEnd: boolean;
      behind: boolean;
      from: string | undefined;
      href: string;
      id: string;
    },
  ): Outcome<string | undefined> => {
    if (onScreen === undefined) {
      return unchanged(state, undefined);
    }
    const opening = ask.atEnd
      ? undefined
      : openingFrom(state, onScreen, ask.from);
    return {
      state: addScreen(state, {
        ...(opening?.tab === undefined ? {} : { after: opening.tab }),
        ...(opening === undefined ? {} : { from: opening }),
        group: onScreen,
        href: ask.href,
        id: ask.id,
        select: !ask.behind,
      }),
      value: ask.id,
    };
  },

  /**
   * Shows the screen tab already at an address in a group (the group on
   * screen, unless one is named), or opens one there. Answers its tab.
   */
  openOrFocusScreen: (
    state: WindowTabs,
    { onScreen }: TabOpContext,
    ask: {
      after?: string;
      from?: Opening;
      group?: string;
      href: string;
      id: string;
      select: boolean;
    },
  ): Outcome<string | undefined> => {
    const key = ask.group ?? onScreen;
    if (key === undefined) {
      return unchanged(state, undefined);
    }
    const opened = openOrFocusScreen(state, {
      ...(ask.after === undefined ? {} : { after: ask.after }),
      group: key,
      href: ask.href,
      id: ask.id,
      ...(ask.from === undefined ? {} : { from: ask.from }),
      isWaiting: key !== onScreen,
      select: ask.select || key === onScreen,
    });
    return { state: opened.state, value: opened.id };
  },

  /**
   * A page in a group (the group on screen, unless one is named), up at once
   * when that group is on screen, when none was named, or when asked.
   */
  openPage: (
    state: WindowTabs,
    { onScreen }: TabOpContext,
    ask: {
      after?: string;
      from?: Opening;
      group?: string;
      page: BrowserTab;
      replacing?: WindowTab;
      select: boolean;
      side?: Placing["side"];
    },
  ): Outcome<undefined> => {
    const key = ask.group ?? onScreen;
    return unchanged(
      openPage(state, {
        ...(ask.after === undefined ? {} : { after: ask.after }),
        ...(ask.from === undefined ? {} : { from: ask.from }),
        ...(ask.side === undefined ? {} : { side: ask.side }),
        group: key,
        page: ask.page,
        ...(ask.replacing ? { replacing: ask.replacing } : {}),
        select: ask.select || ask.group === undefined || key === onScreen,
      }),
      undefined,
    );
  },

  /**
   * A page beside a chat's tab, for the chat's agent or a link pressed in
   * the chat (`openBesideChat`). Answers the tab that shows it and whether
   * it is up on its side; nothing for a chat's tab no group has.
   */
  openPageBesideChat: (
    state: WindowTabs,
    _context: TabOpContext,
    ask: {
      ask: Omit<BesideAsk, "previous">;
      id: string;
      openedAt: number;
      openedBy?: ChatId;
      url?: string;
    },
  ): Outcome<undefined | { front: boolean; id: string }> => {
    const group = state.tabs.find((tab) => tab.id === ask.ask.chatTab)?.group;
    if (group === undefined) {
      return unchanged(state, undefined);
    }
    const previous =
      ask.openedBy === undefined
        ? undefined
        : previousOpenedIn(state, group, ask.openedBy);
    const placed = openBesideChat(
      state,
      {
        group,
        id: ask.id,
        kind: "page",
        openedAt: ask.openedAt,
        ...(ask.openedBy === undefined ? {} : { openedBy: ask.openedBy }),
        ...(ask.url ? { openedUrl: ask.url, url: ask.url } : {}),
      },
      { ...ask.ask, ...(previous === undefined ? {} : { previous }) },
    );
    return {
      state: placed.state,
      value: { front: placed.front, id: placed.id },
    };
  },

  /**
   * A page tab as the pane opens one: in a tab's place, in a named group, or
   * beside the tab up. In the group on screen, or the group asked for: a
   * page opened while a chat is up is the chat's, and one a chat asked for
   * while another was up is still that chat's, waiting behind. Asked for in
   * a new tab, it lands right after the tab up, and waits behind it when
   * asked to.
   */
  openPageTab: (
    state: WindowTabs,
    { onScreen }: TabOpContext,
    ask: {
      after?: string;
      behind: boolean;
      from?: Opening;
      into?: string;
      newTab: boolean;
      page: BrowserTab;
      replacing?: WindowTab;
      show: boolean;
      side?: Placing["side"];
    },
  ): Outcome<undefined> => {
    const group = ask.into ?? onScreen;
    const opening =
      ask.from ??
      (ask.newTab ? openingFrom(state, group, undefined) : undefined);
    const beside = ask.after ?? (ask.newTab ? opening?.tab : undefined);
    return unchanged(
      openPage(state, {
        ...(beside === undefined ? {} : { after: beside }),
        ...(opening === undefined ? {} : { from: opening }),
        group,
        page: ask.page,
        ...(ask.replacing ? { replacing: ask.replacing } : {}),
        select:
          ask.newTab || ask.after !== undefined
            ? !ask.behind
            : !ask.behind &&
              (ask.show || ask.into === undefined || ask.into === onScreen),
        ...(ask.side === undefined ? {} : { side: ask.side }),
      }),
      undefined,
    );
  },

  /**
   * A screen at an address in a group (the group on screen, unless one is
   * named): up at once when that group is on screen or when asked, and
   * otherwise behind whatever it has up. Answers its tab.
   */
  openScreen: (
    state: WindowTabs,
    { onScreen }: TabOpContext,
    ask: {
      after?: string;
      from?: Opening;
      group?: string;
      href: string;
      id: string;
      select: boolean;
      side?: Placing["side"];
    },
  ): Outcome<string | undefined> => {
    const key = ask.group ?? onScreen;
    if (key === undefined) {
      return unchanged(state, undefined);
    }
    return {
      state: addScreen(state, {
        ...(ask.after === undefined ? {} : { after: ask.after }),
        group: key,
        href: ask.href,
        id: ask.id,
        ...(ask.from === undefined ? {} : { from: ask.from }),
        select: ask.select || key === onScreen,
        ...(ask.side === undefined ? {} : { side: ask.side }),
      }),
      value: ask.id,
    };
  },

  /**
   * A screen opened from a chat's tab (`openBesideChat`). Answers the tab
   * that shows it, whether it is up on its side, and the address that tab
   * stood at before; nothing for a chat's tab no group has.
   */
  openScreenBesideChat: (
    state: WindowTabs,
    _context: TabOpContext,
    ask: {
      ask: Omit<BesideAsk, "previous">;
      href: string;
      id: string;
      openedBy?: ChatId;
    },
  ): Outcome<
    undefined | { front: boolean; id: string; was: string | undefined }
  > => {
    const group = state.tabs.find((tab) => tab.id === ask.ask.chatTab)?.group;
    if (group === undefined) {
      return unchanged(state, undefined);
    }
    const previous =
      ask.openedBy === undefined
        ? undefined
        : previousOpenedIn(state, group, ask.openedBy);
    const placed = openBesideChat(
      state,
      {
        group,
        href: ask.href,
        id: ask.id,
        kind: "screen",
        ...(ask.openedBy === undefined ? {} : { openedBy: ask.openedBy }),
      },
      { ...ask.ask, ...(previous === undefined ? {} : { previous }) },
    );
    const there = state.tabs.find((tab) => tab.id === placed.id);
    return {
      state: placed.state,
      value: {
        front: placed.front,
        id: placed.id,
        was: there?.kind === "screen" ? there.href : undefined,
      },
    };
  },

  /** The page the group on screen has up, marked as leaving for another address (`pageNavigated`). */
  pageNavigatedUp: (
    state: WindowTabs,
    { onScreen }: TabOpContext,
  ): Outcome<undefined> => {
    const shown = selectedTabIn(state, onScreen);
    return unchanged(shown ? pageNavigated(state, shown.id) : state, undefined);
  },

  /**
   * Brings up the tab of the group on screen already showing what an address
   * shows (`tabShowingIn`). Answers whether one does.
   */
  selectShowing: (
    state: WindowTabs,
    { onScreen }: TabOpContext,
    href: string,
  ): Outcome<boolean> => {
    const tab =
      onScreen === undefined ? undefined : tabShowingIn(state, onScreen, href);
    return tab
      ? { state: pickTab(state, tab.id), value: true }
      : unchanged(state, false);
  },

  /** A tab with no router of its own stepped along its trail (`stepTrail`). Answers where it landed. */
  stepTrail: (
    state: WindowTabs,
    _context: TabOpContext,
    id: string,
    direction: -1 | 1,
  ): Outcome<string | undefined> => {
    const stepped = stepTrail(state, id, direction);
    return { state: stepped.state, value: stepped.href };
  },

  /** A tab stepped to the visit before or after what it shows (`stepVisit`). Answers the tab as it is then. */
  stepVisit: (
    state: WindowTabs,
    _context: TabOpContext,
    id: string,
    direction: -1 | 1,
  ): Outcome<undefined | WindowTab> => {
    const stepped = stepVisit(state, id, direction);
    return { state: stepped.state, value: stepped.next };
  },
};

/** The name of a change to the tabs. */
export type TabOp = keyof typeof TAB_OPS;

/** What a change is handed, after the tabs and the asking window's own. */
export type TabOpArgs<K extends TabOp> = (typeof TAB_OPS)[K] extends (
  state: WindowTabs,
  context: TabOpContext,
  ...args: infer A
) => unknown
  ? A
  : never;

/** What a change answers, beside the tabs after it. */
export type TabOpValue<K extends TabOp> = ReturnType<
  (typeof TAB_OPS)[K]
>["value"];

/**
 * One change to the tabs, as it is asked for and sent: its name and what it
 * is handed. The two are paired where a change is asked for (`TabsChange`),
 * which a value read off a wire can no longer be shown to be.
 */
export interface TabCommand {
  args: readonly unknown[];
  op: TabOp;
}

/** The tabs after a change, each split sized by what is in it (`withChatSides`), and what it answers. */
export function applyTabCommand(
  state: WindowTabs,
  context: TabOpContext,
  command: TabCommand,
): Outcome<unknown> {
  // Every change takes the tabs, the asker's own, then its arguments.
  const change = TAB_OPS[command.op] as (
    state: WindowTabs,
    context: TabOpContext,
    ...args: readonly unknown[]
  ) => Outcome<unknown>;
  const { state: after, value } = change(state, context, ...command.args);
  return { state: withChatSides(state, after), value };
}
