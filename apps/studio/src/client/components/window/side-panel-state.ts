import { browserTargetOf } from "@instrument-org/workspace/client";
import {
  atom,
  type SetStateAction,
  useAtom,
  useAtomValue,
  useSetAtom,
} from "jotai";
import { atomFamily } from "jotai/utils";
import { useEffect, useEffectEvent, useRef } from "react";

import { type ChatsAsk, chatsAskAtom } from "./chats-ask";
import { type ChatFilters, NO_FILTERS } from "./chats";
import {
  closeExtensionSidePanel,
  useExtensionSidePanelOf,
} from "./extension-side-panel";
import { type GroupLayout, type GroupOwn, isNewChatTab } from "./tab-model";
import { useWindowTabs } from "./window-tabs";

/**
 * Whether a group's side panel is open: as the person last left it there,
 * and otherwise open over a new tab in a group of one side, where something
 * is about to start, and closed over anything else, so sending from the new
 * tab puts it away.
 */
function isSidePanelOpen(
  own: GroupOwn | undefined,
  layout: GroupLayout,
): boolean {
  if (own?.sidePanel !== undefined) {
    return own.sidePanel;
  }
  const [only, other] = layout.sides;
  const up = only?.tabs.find((tab) => tab.id === only.up);
  return other === undefined && up !== undefined && isNewChatTab(up);
}

/**
 * Whether the window has room for the side panel beside the group up, which
 * the window decides as a resize, a zoom or the sidebar crosses the line
 * (`sidePanelRoomOf`). Without room an open panel steps out of the way and
 * comes back once there is room again; one shown without room floats.
 */
const sidePanelRoomAtom = atom(true);

/**
 * Whether the group up's sides fit at their narrowest beside the side panel
 * (`sidesFitBesidePanel`), kept as the window, the sidebar or the group up
 * changes. A panel without it is not shown beside the group; one the
 * person shows floats over it instead.
 */
export const sidesFitAtom = atom(true);

/** A panel the person showed while the window had no room for it, floating until the room changes. */
const shownWithoutRoomAtom = atom(false);

/** The window's room for the side panel changed: a panel shown without room for it follows the room again. */
export const sidePanelRoomChangedAtom = atom(
  null,
  (_get, set, hasRoom: boolean) => {
    set(sidePanelRoomAtom, hasRoom);
    set(shownWithoutRoomAtom, false);
  },
);

/** What a side panel shows: its sections, or one of them whole. */
export type SidePanelView = "apps" | "bookmarks" | "chats" | "files" | "home";

const viewByGroupAtom = atom<Readonly<Partial<Record<string, SidePanelView>>>>(
  {},
);

/** What a group's side panel shows, its sections until one is opened whole. */
export const sidePanelViewAtom = atomFamily((group: string) =>
  atom(
    (get) => get(viewByGroupAtom)[group] ?? "home",
    (get, set, view: SidePanelView) => {
      set(viewByGroupAtom, { ...get(viewByGroupAtom), [group]: view });
    },
  ),
);

const chatFiltersByGroupAtom = atom<
  Readonly<Partial<Record<string, ChatFilters>>>
>({});

/** What a group's side panel narrows its chats to. */
export const sidePanelChatFiltersAtom = atomFamily((group: string) =>
  atom(
    (get) => get(chatFiltersByGroupAtom)[group] ?? NO_FILTERS,
    (get, set, update: SetStateAction<ChatFilters>) => {
      const byGroup = get(chatFiltersByGroupAtom);
      const next =
        typeof update === "function"
          ? update(byGroup[group] ?? NO_FILTERS)
          : update;
      set(chatFiltersByGroupAtom, { ...byGroup, [group]: next });
    },
  ),
);

/** Groups whose side panel puts the caret in its chat search once the search is drawn. */
const searchAskedByGroupAtom = atom<ReadonlySet<string>>(new Set<string>());

/**
 * Whether a group's side panel was asked to put the caret in its chat
 * search; setting it false says the search took it.
 */
export const sidePanelSearchAskedAtom = atomFamily((group: string) =>
  atom(
    (get) => get(searchAskedByGroupAtom).has(group),
    (get, set, isAsked: boolean) => {
      const asked = new Set(get(searchAskedByGroupAtom));
      if (isAsked) {
        asked.add(group);
      } else {
        asked.delete(group);
      }
      set(searchAskedByGroupAtom, asked);
    },
  ),
);

/** Takes the chats asked for (`showChatsInPanel`) to the side panel of `group`, the group up. */
export function useChatsAsks(group: string | undefined) {
  const ask = useAtomValue(chatsAskAtom);
  const setAsk = useSetAtom(chatsAskAtom);
  const { openChats } = useSidePanel(group);
  const take = useEffectEvent((taken: ChatsAsk) => {
    openChats(taken);
  });
  useEffect(() => {
    if (ask === null || group === undefined) {
      return;
    }
    setAsk(null);
    take(ask);
  }, [ask, group, setAsk]);
}

/** Groups whose up tab is changing to a pick from their side panel. */
const pickingIn = new Set<string>();

/**
 * A group's side panel, shown or not, and the way to open or close it there.
 * Beside the group while the window has room for it; opened without room, it
 * floats over the group's far edge instead (`isFloating`) until a pick, a
 * close or the room changes. An extension's panel open in the tab up on the
 * side with the keyboard shows in it whatever the group left it at, as
 * Chrome shows one, and closing the panel closes that too.
 */
export function useSidePanel(group: string | undefined) {
  const windowTabs = useWindowTabs();
  const hasRoom = useAtomValue(sidePanelRoomAtom);
  const sidesFit = useAtomValue(sidesFitAtom);
  const [isShownWithoutRoom, setShownWithoutRoom] =
    useAtom(shownWithoutRoomAtom);
  const [view, setView] = useAtom(sidePanelViewAtom(group ?? ""));
  const [chatFilters, setChatFilters] = useAtom(
    sidePanelChatFiltersAtom(group ?? ""),
  );
  const setSearchAsked = useSetAtom(sidePanelSearchAskedAtom(group ?? ""));
  const layout = group === undefined ? undefined : windowTabs.layoutOf(group);
  const side = layout?.sides[layout.focused];
  const up = side?.tabs.find((tab) => tab.id === side.up);
  const extensionPanel = useExtensionSidePanelOf(
    up?.kind === "page" ? browserTargetOf(up.id) : undefined,
  );
  const isRoomy = hasRoom && sidesFit;
  const isGroupOpen =
    group !== undefined &&
    layout !== undefined &&
    isSidePanelOpen(windowTabs.groupOwn[group], layout);
  const isOpen =
    (group !== undefined && extensionPanel !== undefined) ||
    (isGroupOpen && isRoomy);
  const isFloating = !isOpen && isGroupOpen && !isRoomy && isShownWithoutRoom;
  // Put away, the panel opens next on its sections.
  const setOpen = (open: boolean) => {
    if (!open && extensionPanel) {
      closeExtensionSidePanel(extensionPanel.targetId);
    }
    if (group !== undefined) {
      setShownWithoutRoom(open && !isRoomy);
      windowTabs.setGroupOwn(group, { sidePanel: open });
      if (!open) {
        setView("home");
      }
    }
  };
  const openChats = ({ focus = false, place, project, search }: ChatsAsk) => {
    setView("chats");
    setChatFilters({
      ...NO_FILTERS,
      ...(place === undefined ? {} : { place }),
      projects: project === undefined ? [] : [project],
      search: search ?? "",
    });
    if (focus) {
      setSearchAsked(true);
    }
    setOpen(true);
  };
  return {
    isFloating,
    isOpen,
    /** Whether the panel is on screen, beside the group or floating over it. */
    isShown: isOpen || isFloating,
    setOpen,
    /** Puts a floating panel away and leaves the group's panel as it was. */
    dismissFloat: () => {
      setShownWithoutRoom(false);
    },
    /**
     * Keeps the panel open through a pick from it that lands in the tab
     * up, a new tab's included, which would otherwise put it away. A
     * floating panel goes once the pick lands (`SidePanelFloat`).
     */
    keepForPick: () => {
      if (group !== undefined) {
        pickingIn.add(group);
        windowTabs.setGroupOwn(group, { sidePanel: true });
      }
    },
    /** Opens the panel on the group's chats, every chat or the ones `ask` narrows to. */
    openChats,
    /**
     * Shows the group's chats in its panel, every chat or the chats of
     * `project`, or puts the panel away when it shows just that already.
     */
    showChats: (project: string | undefined) => {
      const projects = project === undefined ? [] : [project];
      const isShowing =
        (isOpen || isFloating) &&
        view === "chats" &&
        chatFilters.projects.join() === projects.join();
      if (isShowing) {
        setOpen(false);
        return;
      }
      openChats(project === undefined ? {} : { project });
    },
  };
}

/**
 * Sending from a new tab puts its group's side panel away: the tab is a
 * chat now, and one the person opened over the new tab goes back to
 * following the tab up, which closes it. One they closed stays closed, and
 * a pick from the panel itself keeps it open.
 */
export function useSidePanelUpkeep(group: string | undefined) {
  const windowTabs = useWindowTabs();
  const layout = group === undefined ? undefined : windowTabs.layoutOf(group);
  const side = layout?.sides[layout.focused];
  const up = side?.tabs.find((tab) => tab.id === side.up);
  const upId = up?.id;
  const isNew = up !== undefined && isNewChatTab(up);
  const where =
    up === undefined ? undefined : up.kind === "screen" ? up.href : up.url;
  const was = useRef<{ id: string; isNew: boolean } | undefined>(undefined);
  const sent = useEffectEvent((at: string) => {
    if (windowTabs.groupOwn[at]?.sidePanel === true) {
      windowTabs.setGroupOwn(at, { sidePanel: undefined });
    }
  });
  useEffect(() => {
    const before = was.current;
    was.current = upId === undefined ? undefined : { id: upId, isNew };
    if (group === undefined || before === undefined) {
      return;
    }
    const picked = pickingIn.delete(group);
    if (!picked && before.isNew && !isNew && before.id === upId) {
      sent(group);
    }
  }, [group, isNew, upId, where]);
}
