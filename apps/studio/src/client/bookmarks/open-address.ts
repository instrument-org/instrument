import {
  type OpenOptions,
  useWindow,
} from "@/client/components/window/context";
import { isGroupScreenHref } from "@/client/components/window/group-screen";
import { matchScreen } from "@/client/components/window/window-href";
import { wantsNewTab, wantsNewWindow } from "@/client/hooks/use-open-target";
import { isScreenName, SCREENS } from "@/shared/instrument-screens";

import { type AddressTarget, hrefOfPath, targetOfAddress } from "./address";

/**
 * Where an address opens: in the tab it was chosen from, in a new tab
 * waiting behind that one, on the other side of the group on screen, or as
 * the first tab of a new tab group or a new window.
 */
export type OpenHow = "here" | "newGroup" | "newTab" | "newWindow" | "split";

/** The open each place but `here` asks of the window. */
const OPEN_OPTIONS = {
  newGroup: { into: "group" },
  newTab: { behind: true, newTab: true },
  newWindow: { into: "window" },
  split: { into: "split" },
} satisfies Record<Exclude<OpenHow, "here">, OpenOptions>;

/**
 * The screen href an address of the app's own opens at: a file's or a
 * folder's in Files, and a built-in page named by its screen
 * (`/screen/activity`) at the page's own href, which a tab can stand at.
 */
export function hrefOfTarget(
  target: Exclude<AddressTarget, { kind: "page" }>,
): string {
  if (target.kind === "path") {
    return hrefOfPath(target);
  }
  const screen = matchScreen(target.href);
  if (screen.kind === "namedScreen" && isScreenName(screen.name)) {
    const own = SCREENS[screen.name];
    return "href" in own ? own.href : target.href;
  }
  return target.href;
}

/** What a click asks for: ⌘-click a new tab behind this one, ⇧-click a new tab group. */
export function openHowOf(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): OpenHow {
  if (wantsNewTab(event)) {
    return "newTab";
  }
  return wantsNewWindow(event) ? "newGroup" : "here";
}

/**
 * Opens any address, a site's or the app's own, the way a bookmark opens.
 * `here` is the tab it was chosen from, when it is chosen from one: a page
 * goes there, and so does a screen a tab of a group can stand at. Anything
 * else opens where the app keeps it: a chat where its tab is, or as a tab
 * group of its own.
 */
export function useOpenAddress(
  here: { page?: (url: string) => void; screen?: (href: string) => void } = {},
) {
  const appWindow = useWindow();
  return (address: string, how: OpenHow = "here") => {
    const target = targetOfAddress(address);
    if (!target) {
      return;
    }
    if (target.kind === "page") {
      if (how === "here") {
        if (here.page) {
          here.page(target.url);
        } else {
          appWindow.openPage(target.url);
        }
        return;
      }
      appWindow.openPage(target.url, OPEN_OPTIONS[how]);
      return;
    }
    const href = hrefOfTarget(target);
    if (how === "here") {
      if (here.screen && isGroupScreenHref(href)) {
        here.screen(href);
      } else {
        appWindow.openScreen(href);
      }
      return;
    }
    appWindow.openScreen(href, OPEN_OPTIONS[how]);
  };
}
