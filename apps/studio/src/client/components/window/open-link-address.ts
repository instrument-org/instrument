import { openSettings } from "@/client/atoms/settings-modal";
import { openShortcutGuide } from "@/client/atoms/shortcut-guide-modal";
import { toast } from "@/client/lib/toast";
import { isScreenName, SCREENS } from "@/shared/instrument-screens";
import { APP_NAME } from "@instrument-org/shared";

import { chatsAskOf, showChatsInPanel } from "./chats-ask";
import { type LINK_ADDRESSES, matchScreen } from "./window-href";

/**
 * Brings up the tab group or tab a reply linked, or says it closed: set by
 * the window's openers once they are up (`useOpeners`).
 */
let showLinked: ((kind: "group" | "tab", id: string) => void) | undefined;

/** Sets what a link to a tab group or a tab does in this window. */
export function setLinkedShower(
  show: ((kind: "group" | "tab", id: string) => void) | undefined,
) {
  showLinked = show;
}

/**
 * Where each kind of link address opens, by the name it carries: somewhere
 * outside the tabs (Settings, a dialog), answering nothing, or the route a
 * tab stands at for it. Keyed by every link address, so one added there is
 * a type error here until it says where it goes.
 */
const OPEN_LINK = {
  // A memory is a file, which the window's openers find and open as one
  // (`useOpeners`). Reaching here, the name has no file, or the address came
  // straight to the tabs: the Memory page shows the memories there are, and
  // says when the one named is gone.
  memory: (memory) => {
    openSettings({ memory, tab: "Memory" });
    return undefined;
  },
  // A screen a reply named opens where it lives: a place at its own
  // address, or a dialog over the window.
  namedScreen: (name) => {
    if (!isScreenName(name)) {
      toast(`This version of ${APP_NAME} doesn't have that screen`);
      return undefined;
    }
    if (name === "chats") {
      showChatsInPanel();
      return undefined;
    }
    const screen = SCREENS[name];
    if ("href" in screen) {
      return screen.href;
    }
    openShortcutGuide();
    return undefined;
  },
  // A project has no screen: its details open over the window, once the
  // workspace has said which project the id or name is. The opener is
  // loaded when used, as a skill's is.
  project: (project) => {
    void import("@/client/lib/show-project").then(({ showProject }) =>
      showProject(project),
    );
    return undefined;
  },
  // A setting is shown in Settings, on its part and lit, in the Settings
  // tab of the group up or a new one; a name Settings has no row or part
  // for is searched for there instead. A part's own name is its route.
  setting: (setting) => {
    openSettings({ setting });
    return undefined;
  },
  // A skill is a folder, shown in Files in a tab of the window's own. Which
  // folder is the workspace's answer, so it opens once that arrives. The
  // opener is loaded when used: it adds to the window's tabs, which open
  // every link address through here.
  skill: (skill) => {
    void import("@/client/lib/show-in-files").then(({ showSkillFolder }) =>
      showSkillFolder(skill),
    );
    return undefined;
  },
  // A tab group or a tab is no screen: the window brings it up where it is.
  tabGroup: (group) => {
    showLinked?.("group", group);
    return undefined;
  },
  windowTab: (tab) => {
    showLinked?.("tab", tab);
    return undefined;
  },
} satisfies Record<
  keyof typeof LINK_ADDRESSES,
  (name: string) => string | undefined
>;

/**
 * Opens a link address (`LINK_ADDRESSES`) where the thing it names lives,
 * and answers the address a tab should stand at instead: the address itself
 * for any screen of the window's, a named screen's own route, or nothing
 * when what it named opened outside the tabs, as the chat list does in the
 * side panel.
 *
 * No route draws a link address, so a tab standing at one is a blank screen.
 * Every way of putting an address in a tab (the openers, and under them the
 * window's and a group's tabs) asks this first.
 */
export function openLinkAddress(href: string): string | undefined {
  const screen = matchScreen(href);
  switch (screen.kind) {
    // The chat list has no page: its chats show in the side panel.
    case "chats": {
      showChatsInPanel(chatsAskOf(href));
      return undefined;
    }
    case "memory":
    case "namedScreen":
    case "project":
    case "setting":
    case "skill":
    case "tabGroup":
    case "windowTab": {
      return OPEN_LINK[screen.kind](screen.name);
    }
    default: {
      return href;
    }
  }
}
