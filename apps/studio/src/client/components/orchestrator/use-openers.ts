import { placeOfGroup, THREADS_HREF } from "@/client/atoms/orchestrator";
import { openSettings } from "@/client/atoms/settings-modal";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { fileHref, folderHref } from "@/shared/computer-href";
import {
  isFolderPath,
  type StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { type BrowserTabsHandle } from "./browser-tabs";
import { type OpenOptions } from "./context";
import { computerTabOf } from "./file-tabs";
import { memoryOfHref, tasksFaceOfHref } from "./tab-location";
import { type Thread } from "./threads";
import {
  isFreshTab,
  parseHref,
  threadOfHref,
  threadOfHrefPrefix,
  type useWindowTabs,
} from "./window-tabs";

/**
 * What the conversation asks to open, as it asks: a page as a tab, a path
 * of the user's as the tab that shows it. The openers are read at the moment
 * of each ask, since they close over the tabs as they are then.
 */
export function useOpeners({
  browser,
  ids,
  revealPane,
  setPaneOpen,
  showTasksFace,
  threads,
  threadTitles,
  toChat,
  windowTabs,
}: {
  /** The window's browser; null until it is mounted. */
  browser: BrowserTabsHandle | null;
  /** The orchestrator, once it exists; a path is resolved against it, and nothing it asks for is opened before then. */
  ids: RPCOutput["workspace"]["orchestrator"]["ensure"] | undefined;
  /** Brings the pane up for the group on screen, for something opened into it. */
  revealPane: () => void;
  setPaneOpen: (group: string, isOpen: boolean) => void;
  /** Brings the tasks' face up over a thread, for an address that names a task or the tasks. */
  showTasksFace: (task?: TaskId, group?: string) => void;
  /** The threads the window has, once the list has been read. */
  threads: Thread[] | undefined;
  threadTitles: Map<StoreId.Session, string>;
  /** Puts the window on the chat, for a thread coming on screen from wherever it stands. */
  toChat: () => void;
  windowTabs: ReturnType<typeof useWindowTabs>;
}) {
  const router = useRouter();
  const { active } = windowTabs;
  const isFreshNewTab = active !== undefined && isFreshTab(active);
  // A task's tab is the task's: the guest in it is the one the task is
  // driving, and taking its place in the strip would leave the task browsing
  // where nobody can see it. Everything else gives its place up in place.
  const isTaskTab = active?.kind === "page" && Boolean(active.taskId);
  /**
   * Opens a page: in the tab on screen when it is a page of the window's
   * own, in a tab of its own when asked for one, and into a named group when
   * the open belongs to a thread other than the one up, where it waits
   * behind. Opened into the group on screen, it brings the pane up.
   */
  const openPage = (
    url: string,
    { group: into, newTab = false, show = false }: OpenOptions = {},
  ) => {
    if (into !== undefined && into !== windowTabs.group) {
      const id = browser?.openOrFocus(url, { group: into, show });
      if (show) {
        setPaneOpen(into, true);
      }
      return id;
    }
    if (windowTabs.group === undefined) {
      // Nothing is on screen to open it in: a page belongs to a thread or a
      // draft, never to the window on its own.
      return;
    }
    revealPane();
    if (!newTab && active?.kind === "page" && !active.taskId) {
      browser?.navigate(url);
      return active.id;
    }
    // A tab of its own is asked for once per place: a page already open in
    // this group at that address comes forward rather than opening again.
    if (newTab && !isFreshNewTab) {
      return browser?.openOrFocus(url);
    }
    return browser?.open(
      url,
      active && !isTaskTab && (!newTab || isFreshNewTab)
        ? { replacing: active }
        : undefined,
    );
  };
  const openScreen = (
    href: string,
    { group: into, newTab = false, show = false }: OpenOptions = {},
  ) => {
    // A whole id, or the start of one the way a reply's link carries it,
    // among the threads the window has: a whole id that names none of them
    // is a link to a thread since deleted, not a thread with nothing in it.
    // Until the list has been read, a whole id is taken on its own.
    const thread = threads
      ? threadOfHrefPrefix(href, threadTitles.keys())
      : threadOfHref(href);
    if (thread) {
      // The thread's group comes up at the tab it last had up, and the
      // address follows that tab; pushing the thread's own address here
      // would send the tab on screen there. A thread is on the chat,
      // wherever the window stood when it was asked for.
      windowTabs.showThread(thread);
      toChat();
      return;
    }
    if (parseHref(href).pathname.startsWith(`${THREADS_HREF}/`)) {
      // A thread's address that names none of the threads here: a screen
      // at it would be a thread with nothing in it.
      toast("No thread at that address", {
        description:
          "It may have been deleted, or the link is not for this chat.",
      });
      return;
    }
    // A task, or the tasks, are the face of their thread's pane rather than
    // a screen of their own: every way of asking for one lands there.
    const face = tasksFaceOfHref(href);
    if (face) {
      showTasksFace(face.task, into);
      return;
    }
    // A memory is shown where all of them are, in Settings, brought to the
    // one named; a screen of its own would be one memory with nothing to do
    // to it.
    const memory = memoryOfHref(href);
    if (memory) {
      openSettings({ memory, tab: "Memory" });
      return;
    }
    if (into !== undefined && into !== windowTabs.group) {
      windowTabs.openOrFocusScreen(href, {
        group: into,
        isOpened: true,
        show,
      });
      if (show) {
        setPaneOpen(into, true);
      }
      return;
    }
    if (windowTabs.group === undefined) {
      // Nothing is on screen to open it in: a screen belongs to a thread, a
      // draft or a place, never to the window on its own.
      return;
    }
    revealPane();
    // In Files the computer is the place's own face, so a file opened from
    // it is a tab of its own beside it rather than the computer's tab
    // becoming the file.
    const asOwnTab =
      newTab ||
      (placeOfGroup(windowTabs.group) === "files" &&
        computerTabOf(href)?.file !== undefined);
    if (!active) {
      // Nothing in the pane to open it in place of.
      windowTabs.openScreen(href);
    } else if (asOwnTab && !isFreshNewTab) {
      windowTabs.openOrFocusScreen(href);
    } else {
      windowTabs.navigateScreen(href);
      router.history.push(href);
    }
  };
  /**
   * Opens a path a reply named: a file in its viewer, a folder as the folder
   * view standing in it.
   *
   * A reply names a path the way the conversation reaches it, and both tabs
   * are addressed by where the thing sits on the computer, so the translation
   * happens here, against the conversation's own layout. A path under nothing
   * the conversation has is one this window cannot stand in, and saying so
   * beats a tab rooted nowhere.
   */
  const openNamedPath = (path: string, options?: OpenOptions) => {
    if (!ids) {
      return;
    }
    const isFolder = isFolderPath(path);
    const filePath = isFolder ? path.slice(0, -1) : path;
    void (async () => {
      const [error, hostPaths] = await safe(
        rpcClient.workspace.task.files.hostPaths.call({
          filePaths: [filePath],
          taskId: ids.taskId,
        }),
      );
      const hostPath = hostPaths?.[filePath];
      if (error || !hostPath) {
        toast(`Nothing at “${path}”`, {
          description: isFolder
            ? "Not a folder Instrument can reach."
            : "Not a file Instrument can reach.",
        });
        return;
      }
      openScreen(isFolder ? folderHref(hostPath) : fileHref(hostPath), options);
    })();
  };

  const openers = useRef({ openNamedPath, openPage, openScreen });
  useEffect(() => {
    openers.current = { openNamedPath, openPage, openScreen };
  });
  // A screen a link from outside asked for while this window was opening:
  // the command stream below could not carry it to a renderer not yet
  // listening, so it is asked for once the window can show it.
  const isReady = ids !== undefined;
  useEffect(() => {
    if (!isReady) {
      return;
    }
    void (async () => {
      const [, href] = await safe(
        rpcClient.orchestrator.takePendingScreen.call(),
      );
      if (href) {
        openers.current.openScreen(href, { newTab: true });
      }
    })();
  }, [isReady]);
  useEffect(() => {
    if (!ids) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const asks = await rpcClient.workspace.orchestrator.events.open.call(
          { id: ids.taskId },
          { signal: controller.signal },
        );
        for await (const target of asks) {
          // Into the thread that asked, which may not be the one on screen.
          const group = target.sessionId;
          if (target.kind === "page") {
            const tabId = openers.current.openPage(target.url, {
              ...(group ? { group } : {}),
              newTab: true,
            });
            // The tab's id goes back to the command that asked, so the
            // conversation can hand the tab to a task without waiting for
            // the next message's note to name it.
            if (tabId) {
              void rpcClient.workspace.orchestrator.opened.call({
                id: ids.taskId,
                requestId: target.requestId,
                tabId,
              });
            }
          } else {
            openers.current.openNamedPath(target.mount, {
              ...(group ? { group } : {}),
              newTab: true,
            });
          }
        }
      } catch {
        // The window closing ends the stream.
      }
    })();
    return () => {
      controller.abort();
    };
  }, [ids]);
  return { openNamedPath, openPage, openScreen };
}
