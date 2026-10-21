import { openSettings } from "@/client/atoms/settings-modal";
import { openShortcutGuide } from "@/client/atoms/shortcut-guide-modal";
import { toast } from "@/client/lib/toast";
import { isScreenName, SCREENS } from "@/shared/instrument-screens";
import { APP_NAME } from "@instrument-org/shared";

import { type LINK_ADDRESSES, matchScreen } from "./window-href";

/**
 * Where each kind of link address opens, by the name it carries: somewhere
 * outside the tabs (Settings, a dialog), answering nothing, or the route a
 * tab stands at for it. Keyed by every link address, so one added there is
 * a type error here until it says where it goes.
 */
const OPEN_LINK = {
  // A memory is a file, which the window's openers find and open as one
  // (`useOpeners`). Reaching here, the name has no file, or the address came
  // straight to the tabs: Settings shows the memories there are, and says
  // when the one named is gone.
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
    const screen = SCREENS[name];
    if ("href" in screen) {
      return screen.href;
    }
    openShortcutGuide();
    return undefined;
  },
  // A setting is shown in Settings, on its page and lit; a name Settings has
  // no row or page for is searched for there instead.
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
} satisfies Record<
  keyof typeof LINK_ADDRESSES,
  (name: string) => string | undefined
>;

/**
 * Opens a link address (`LINK_ADDRESSES`) where the thing it names lives,
 * and answers the address a tab should stand at instead: the address itself
 * for any screen of the window's, a named screen's own route, or nothing
 * when what it named opened outside the tabs.
 *
 * No route draws a link address, so a tab standing at one is a blank screen.
 * Every way of putting an address in a tab (the openers, and under them the
 * window's and a group's tabs) asks this first.
 */
export function openLinkAddress(href: string): string | undefined {
  const screen = matchScreen(href);
  switch (screen.kind) {
    case "memory":
    case "namedScreen":
    case "setting":
    case "skill": {
      return OPEN_LINK[screen.kind](screen.name);
    }
    default: {
      return href;
    }
  }
}
