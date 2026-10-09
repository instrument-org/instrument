import {
  commandMenuOpenAtom,
  toggleCommandMenu,
} from "@/client/atoms/command-menu";
import { openSettings } from "@/client/atoms/settings-modal";
import { openClearBrowsingData } from "@/client/atoms/clear-browsing-data-modal";
import { openShortcutGuide } from "@/client/atoms/shortcut-guide-modal";
import {
  blockingModalCountAtom,
  modalBackStackAtom,
} from "@/client/atoms/tab-navigation-block";
import { appZoomAfter, zoomAtom } from "@/client/atoms/zoom";
import { requestPageEditToggle } from "@/client/components/window/page-edit-state";
import { runPageChord } from "@/client/lib/page-chords";
import { isMacOS } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { safe } from "@orpc/client";
import { useRouter } from "@tanstack/react-router";
import { getDefaultStore } from "jotai";
import { useEffect, useRef } from "react";

/** How long the window waits before listening again to a stream that dropped. */
const RECONNECT_DELAY_MS = 1000;

/**
 * The chords that still run while a dialog is open: they change what the
 * window shows around the dialog, never which tab is up, so they cannot move
 * the user out from under it. Every other chord waits for the dialog to close.
 */
const MODAL_SAFE_COMMANDS = new Set([
  "clearBrowsingData",
  "findInPage",
  "openSettings",
  "openShortcutGuide",
  "reloadPage",
  "toggleInbox",
  "zoomIn",
  "zoomOut",
  "zoomReset",
]);

/**
 * What the main process asks of the window: back and forward from a trackpad
 * swipe, a thumb button or the History menu, the tab chords (close, new,
 * reopen, next and previous, one by number), the caret into the field, a
 * screen a link from outside the app named, and a file handed to the app.
 * On a Mac the thumb buttons reach the page as mouse events, so they are
 * answered here; elsewhere they arrive through the main process. Chromium
 * walks the renderer's own history on the same mouseup unless the page
 * consumes it, and that history is not the tab's: left alone, back moved the
 * tab one step and the renderer one step, and the second undid the first.
 * Back and forward from the main process go to the page holding the keyboard
 * first, which steps the way a thumb press over it does; a thumb press over
 * the window's own chrome is the window's.
 */
export function useWindowCommands(
  handlers: {
    /** The tab's own history, behind whatever the tab up walks first (a site's page): the only history a thumb or a menu reaches. */
    back: () => void;
    closeTab: () => void;
    forward: () => void;
    /** A draft of a new chat, at the corner. */
    newChat: () => void;
    newTab: () => void;
    /** A file handed to the app from outside it: a double click, Open With, or a launch naming it. */
    openFile: (hostPath: string) => void;
    /** A screen by its route, in a tab of its own, since what asked is not in any tab. */
    openScreen: (href: string) => void;
    reopenTab: () => void;
    /** The caret into the window's field, wherever it was. */
    search: () => void;
    /** The next or previous chat of the inbox, as listed. */
    selectChat: (direction: -1 | 1) => void;
    selectRelative: (direction: -1 | 1) => void;
    selectTab: (index: number) => void;
    /** The inbox column put away or brought back. */
    toggleInbox: () => void;
  },
  {
    isReady,
  }: {
    /** Whether the window can show what was asked of it while it was opening. */
    isReady: boolean;
  },
) {
  const router = useRouter();
  // The stream is opened once; what a chord means is read at the moment it
  // fires, off whatever tab is up then.
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const isThumb = (event: MouseEvent) =>
      event.button === 3 || event.button === 4;
    // Consumed at every stage, on the way down, so neither Chromium's own
    // navigation nor a click handler under the pointer sees the press.
    const swallow = (event: MouseEvent) => {
      if (isThumb(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const onMouseUp = (event: MouseEvent) => {
      if (!isThumb(event)) {
        return;
      }
      swallow(event);
      if (heldByModal(event.button === 3 ? "back" : "forward")) {
        return;
      }
      if (event.button === 3) {
        latest.current.back();
      } else {
        latest.current.forward();
      }
    };
    // The chords for the field and the command menu, taken before anything on
    // the page reads them: the native menu is only offered the keys web
    // content left alone, and the composer's editor takes these for itself.
    // The menu items stay for the case this cannot see, a focused page guest,
    // whose keys never reach here.
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "l"
      ) {
        event.preventDefault();
        latest.current.search();
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        openOrCloseCommandMenu();
      }
      // Edit on the page on screen, for a key the main process did not take
      // first.
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "e"
      ) {
        event.preventDefault();
        requestPageEditToggle();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    if (isMacOS()) {
      window.addEventListener("mousedown", swallow, { capture: true });
      window.addEventListener("mouseup", onMouseUp, { capture: true });
      window.addEventListener("auxclick", swallow, { capture: true });
    }
    const controller = new AbortController();
    const listen = async () => {
      try {
        const commands = await rpcClient.window.events.command.call(undefined, {
          signal: controller.signal,
        });
        for await (const command of commands) {
          if (typeof command === "object") {
            if (command.type === "selectTab") {
              // A tab by its place is a tab chord too, held under a dialog.
              if (getDefaultStore().get(blockingModalCountAtom) === 0) {
                latest.current.selectTab(command.index);
              }
            } else {
              answer(latest.current, command);
            }
            continue;
          }
          if (command === "commandMenu") {
            openOrCloseCommandMenu();
            continue;
          }
          if (
            (command === "back" || command === "forward") &&
            heldByModal(command)
          ) {
            continue;
          }
          if (
            !MODAL_SAFE_COMMANDS.has(command) &&
            getDefaultStore().get(blockingModalCountAtom) > 0
          ) {
            continue;
          }
          switch (command) {
            case "back": {
              if (!runPageChord("back")) {
                latest.current.back();
              }
              break;
            }
            case "closeTab": {
              latest.current.closeTab();
              break;
            }
            case "editPage": {
              // The page tab on screen, when it shows a page's file; nothing
              // otherwise.
              requestPageEditToggle();
              break;
            }
            case "findInPage": {
              // The page on screen registers itself as the foreground
              // browser; with none up there is nothing to search.
              runPageChord("findInPage");
              break;
            }
            case "forward": {
              if (!runPageChord("forward")) {
                latest.current.forward();
              }
              break;
            }
            case "newChat": {
              latest.current.newChat();
              break;
            }
            case "newTab": {
              latest.current.newTab();
              break;
            }
            case "nextChat": {
              latest.current.selectChat(1);
              break;
            }
            case "nextTab": {
              latest.current.selectRelative(1);
              break;
            }
            case "openSettings": {
              openSettings({ tab: "General" });
              break;
            }
            case "clearBrowsingData": {
              openClearBrowsingData();
              break;
            }
            case "openShortcutGuide": {
              openShortcutGuide();
              break;
            }
            case "previousChat": {
              latest.current.selectChat(-1);
              break;
            }
            case "previousTab": {
              latest.current.selectRelative(-1);
              break;
            }
            case "reloadPage": {
              // The page on screen, when there is one; nothing otherwise.
              runPageChord("reloadPage");
              break;
            }
            case "reopenTab": {
              latest.current.reopenTab();
              break;
            }
            case "search": {
              latest.current.search();
              break;
            }
            case "toggleInbox": {
              latest.current.toggleInbox();
              break;
            }
            case "zoomIn":
            case "zoomOut":
            case "zoomReset": {
              // The page holding the keyboard, else the app's own zoom.
              if (!runPageChord(command)) {
                getDefaultStore().set(zoomAtom, (z) =>
                  appZoomAfter(command, z),
                );
              }
              break;
            }
          }
        }
      } catch {
        // Ended below: a window closing and a dropped transport look alike.
      }
      // The stream ends for good only when the window goes, which aborts it.
      // Anything else (a hot reload, a transport reset) is listened to again
      // after a pause, so the chords never stay unwired.
      if (!controller.signal.aborted) {
        setTimeout(() => {
          if (!controller.signal.aborted) {
            void listen();
          }
        }, RECONNECT_DELAY_MS);
      }
    };
    void listen();
    return () => {
      controller.abort();
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("mousedown", swallow, { capture: true });
      window.removeEventListener("mouseup", onMouseUp, { capture: true });
      window.removeEventListener("auxclick", swallow, { capture: true });
    };
  }, [router]);
  // What links and files from outside asked for while this window was
  // opening: the command stream could not carry them to a renderer not yet
  // listening, so they are asked for once the window can show them.
  useEffect(() => {
    if (!isReady) {
      return;
    }
    void (async () => {
      const [, asks] = await safe(rpcClient.window.takePending.call());
      for (const ask of asks ?? []) {
        answer(latest.current, ask);
      }
    })();
  }, [isReady]);
}

/**
 * The command menu's chord: closes the menu when it is up, and opens it only
 * when no other dialog is, since the menu is a dialog of its own and two
 * would stack.
 */
function openOrCloseCommandMenu() {
  const store = getDefaultStore();
  if (
    store.get(commandMenuOpenAtom) ||
    store.get(blockingModalCountAtom) === 0
  ) {
    toggleCommandMenu();
  }
}

/** Puts up what something outside the window asked for: a file, or a screen by its route. */
function answer(
  handlers: {
    openFile: (hostPath: string) => void;
    openScreen: (href: string) => void;
  },
  ask: RPCOutput["window"]["takePending"][number],
) {
  if (ask.type === "openFile") {
    handlers.openFile(ask.hostPath);
  } else {
    handlers.openScreen(ask.href);
  }
}

/**
 * Whether a modal holds the window, answering back itself when it does: the
 * innermost registered back runs, and forward does nothing. Either way the
 * tab behind stays where it is.
 */
function heldByModal(direction: "back" | "forward") {
  const store = getDefaultStore();
  if (store.get(blockingModalCountAtom) === 0) {
    return false;
  }
  if (direction === "back") {
    store.get(modalBackStackAtom).at(-1)?.run();
  }
  return true;
}
