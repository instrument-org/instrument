import { APPS_HREF, THREADS_HREF } from "@/client/atoms/orchestrator";
import { openSettings } from "@/client/atoms/settings-modal";
import { WINDOW_BROWSER_HOST } from "@/client/lib/browser-host";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { fileHref, folderHref } from "@/shared/computer-href";
import {
  isFolderPath,
  StoreId,
  type TaskId,
  type WindowTabRequest,
} from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { newSiteGroup, pageHrefOf, type useAppTabs } from "./app-tabs";
import { type BrowserTabsHandle } from "./browser-tabs";
import { type OpenOptions } from "./context";
import { visitInTab } from "./tab-history";
import { memoryOfHref, taskHref, tasksHref, tasksOfHref } from "./tab-location";
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
  appTabs,
  browser,
  ids,
  revealPane,
  setPaneOpen,
  threadOfTask,
  threads,
  threadTitles,
  windowTabs,
}: {
  /** The window's tabs: what is not a chat's opens by moving the tab up, or in a tab of its own. */
  appTabs: ReturnType<typeof useAppTabs>;
  /** The window's browser; null until it is mounted. */
  browser: BrowserTabsHandle | null;
  /** The orchestrator, once it exists; a path is resolved against it, and nothing it asks for is opened before then. */
  ids: RPCOutput["workspace"]["orchestrator"]["ensure"] | undefined;
  /** Brings the pane up for the group on screen, for something opened into it. */
  revealPane: () => void;
  setPaneOpen: (group: string, isOpen: boolean) => void;
  /** The chat a task was filed from, which is the group its tab lands in. */
  threadOfTask: (id: TaskId) => string | undefined;
  /** The threads the window has, once the list has been read. */
  threads: Thread[] | undefined;
  threadTitles: Map<StoreId.Session, string>;
  windowTabs: ReturnType<typeof useWindowTabs>;
}) {
  const queryClient = useQueryClient();
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
    {
      activate = false,
      behind = false,
      group: into,
      newTab = false,
      ownTab = false,
      replace = false,
      show = false,
    }: OpenOptions = {},
  ) => {
    if (newTab) {
      // A tab of the window's own, wherever it was asked for from: the site
      // is that tab's page.
      const group = newSiteGroup();
      const id = browser?.open(url, { group });
      appTabs.open(pageHrefOf(group), { select: !behind });
      return id;
    }
    if (into !== undefined && into !== windowTabs.group) {
      const id = browser?.openOrFocus(url, { group: into, show });
      if (show) {
        setPaneOpen(into, true);
      } else if (activate && id !== undefined) {
        windowTabs.selectIn(into, id);
      }
      return id;
    }
    if (windowTabs.group === undefined) {
      // A screen that is its tab's own route: the site is the tab's page,
      // and back from it returns here, unless the screen was only handing
      // its file over, in which case the page takes its place.
      const group = newSiteGroup();
      const id = browser?.open(url, { group });
      appTabs.navigate(pageHrefOf(group), { replace });
      return id;
    }
    revealPane();
    if (!ownTab && active?.kind === "page" && !active.taskId) {
      browser?.navigate(url);
      return active.id;
    }
    // A tab of its own: a website opens again however many tabs are on it,
    // and a file already open in this group comes forward.
    if (ownTab && !isFreshNewTab) {
      return browser?.openOrFocus(url);
    }
    return browser?.open(
      url,
      active && !isTaskTab && (!ownTab || isFreshNewTab)
        ? { replacing: active }
        : undefined,
    );
  };
  const openScreen = (
    href: string,
    {
      activate = false,
      group: into,
      newTab = false,
      ownTab = false,
      show = false,
    }: OpenOptions = {},
  ) => {
    // A whole id, or the start of one the way a reply's link carries it,
    // among the threads the window has: a whole id that names none of them
    // is a link to a thread since deleted, not a thread with nothing in it.
    // Until the list has been read, a whole id is taken on its own.
    const thread = threads
      ? threadOfHrefPrefix(href, threadTitles.keys())
      : threadOfHref(href);
    if (thread) {
      // A chat is a place a tab stands: the tab up goes there, a step on in
      // its history, and the chat comes up at the tab it last had up.
      appTabs.go(`${THREADS_HREF}/${thread}`, { newTab });
      return;
    }
    if (parseHref(href).pathname.startsWith(`${THREADS_HREF}/`)) {
      // A thread's address that names none of the threads here: a screen
      // at it would be a thread with nothing in it.
      toast("No chat at that address", {
        description:
          "It may have been deleted, or the link is not for this chat.",
      });
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
    // A chat's tasks, or one task, are a tab in the chat's group, a task in
    // the chat it was filed from, with the chat on screen and its pane open.
    // A tasks tab already up in that chat walks there in place, the way its
    // crumbs do; anything else gets the tab at that address, or a new one.
    const tasks = tasksOfHref(href);
    const tasksThread = tasks
      ? StoreId.SessionSchema.safeParse(
          (tasks.task === undefined ? undefined : threadOfTask(tasks.task)) ??
            tasks.thread ??
            into ??
            windowTabs.group,
        )
      : undefined;
    if (tasks && tasksThread?.success) {
      const chat = tasksThread.data;
      const at =
        tasks.task === undefined ? tasksHref(chat) : taskHref(tasks.task, chat);
      const up = windowTabs.tabUpIn(chat);
      const walksInPlace =
        !newTab &&
        !ownTab &&
        chat === windowTabs.group &&
        up?.kind === "screen" &&
        tasksOfHref(up.href) !== undefined;
      if (walksInPlace) {
        revealPane();
        windowTabs.navigateScreen(at);
        return;
      }
      // In a tab of the window's own, the chat comes up there at its tasks.
      if (newTab || chat !== windowTabs.group) {
        appTabs.go(`${THREADS_HREF}/${chat}`, { newTab });
      }
      windowTabs.openOrFocusScreen(at, {
        group: chat,
        isOpened: true,
        show: true,
      });
      setPaneOpen(chat, true);
      return;
    }
    // Anything else in a tab of the window's own, wherever it was asked
    // for from.
    if (newTab) {
      appTabs.open(href);
      return;
    }
    // An app is a place a tab stands, wherever it was asked for from.
    if (parseHref(href).pathname.startsWith(`${APPS_HREF}/`)) {
      appTabs.navigate(href);
      return;
    }
    if (into !== undefined && into !== windowTabs.group) {
      windowTabs.openOrFocusScreen(href, {
        activate,
        group: into,
        isOpened: true,
        show,
      });
      if (show) {
        setPaneOpen(into, true);
      }
      return;
    }
    // Outside a chat, a screen is the tab's own: the tab up goes there, or a
    // tab of its own does.
    if (!StoreId.SessionSchema.safeParse(windowTabs.group).success) {
      appTabs.navigate(href);
      return;
    }
    revealPane();
    // A file opened from a Finder takes the Finder's place in its tab, the
    // way a folder does, and back returns to the folder.
    if (!active) {
      // Nothing in the pane to open it in place of.
      windowTabs.openScreen(href);
    } else if (ownTab && !isFreshNewTab) {
      windowTabs.openOrFocusScreen(href);
    } else {
      windowTabs.navigateScreen(href);
    }
  };
  /**
   * Where a path a reply or the conversation named is on the computer, as the
   * address of the tab that shows it, or undefined, said to the user, when it
   * names nothing this window can reach.
   *
   * A path a chat named is read against that chat's own record: its own
   * folder and grants are what `/task` and `/mnt` mean to it. The window's
   * record reads it where no chat is in view.
   */
  const hrefOfNamedPath = async (
    path: string,
    group: string | undefined,
  ): Promise<string | undefined> => {
    if (!ids) {
      return;
    }
    const isFolder = isFolderPath(path);
    const filePath = isFolder ? path.slice(0, -1) : path;
    const thread = StoreId.SessionSchema.safeParse(group ?? windowTabs.group);
    const chat = thread.success
      ? await queryClient
          .fetchQuery(
            rpcClient.workspace.orchestrator.chats.of.queryOptions({
              input: { sessionId: thread.data },
              staleTime: Number.POSITIVE_INFINITY,
            }),
          )
          .catch(() => {
            // No record for the chat: the path resolves against the task it names.
          })
      : undefined;
    const [error, hostPaths] = await safe(
      rpcClient.workspace.task.files.hostPaths.call({
        filePaths: [filePath],
        taskId: chat?.taskId ?? ids.taskId,
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
    return isFolder ? folderHref(hostPath) : fileHref(hostPath);
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
    void hrefOfNamedPath(path, options?.group).then((href) => {
      if (href !== undefined) {
        openScreen(href, options);
      }
    });
  };
  /**
   * Does what an agent asked of the tabs, and says what came of it: the tab
   * it made or acted on, or why it did nothing. An id is looked up among the
   * tabs of the chat that asked, since those are the tabs its note named.
   */
  const actOnTab = async ({
    action,
    sessionId: group,
  }: WindowTabRequest): Promise<{ error?: string; tabId?: string }> => {
    if (action.kind === "open") {
      const { target } = action;
      if (target.kind === "page") {
        // A page opened for an agent's own work joins its chat's tabs
        // behind whatever is up; only one the conversation is showing the
        // user comes on screen.
        if (!action.show && group) {
          return { tabId: browser?.openBehind(target.url, group) };
        }
        return target.url === undefined
          ? { error: "a tab on screen needs an address." }
          : {
              tabId: openPage(target.url, {
                ...(group ? { group } : {}),
                ownTab: true,
              }),
            };
      }
      const href = await hrefOfNamedPath(target.mount, group);
      if (href === undefined) {
        return { error: `nothing this window can show is at ${target.mount}.` };
      }
      const into = group ?? windowTabs.group;
      const tabId = windowTabs.openOrFocusScreen(href, {
        ...(into ? { group: into } : {}),
        isOpened: true,
        show: true,
      });
      if (into) {
        setPaneOpen(into, true);
      }
      return { tabId };
    }
    const tab = windowTabs.allTabs.find(
      (entry) =>
        entry.id === action.tabId &&
        (group === undefined || entry.group === group),
    );
    if (!tab) {
      return { error: `no tab ${action.tabId} is open in this chat.` };
    }
    switch (action.kind) {
      case "close": {
        windowTabs.close(tab.id);
        return { tabId: tab.id };
      }
      case "replace": {
        const { target } = action;
        if (target.kind === "page") {
          if (target.url === undefined) {
            return { error: "replace needs an address or a path." };
          }
          if (tab.kind === "page") {
            browser?.navigateTab(tab.id, target.url);
            return { tabId: tab.id };
          }
          return { tabId: browser?.pageInPlaceOf(tab, target.url) };
        }
        const href = await hrefOfNamedPath(target.mount, group);
        if (href === undefined) {
          return {
            error: `nothing this window can show is at ${target.mount}.`,
          };
        }
        const next = visitInTab(tab, {
          at: 0,
          href,
          id: `screen-${crypto.randomUUID()}`,
          kind: "screen",
          trail: [href],
        });
        windowTabs.replace(tab.id, next);
        return { tabId: next.id };
      }
      case "restore": {
        return browser?.restore(tab.id)
          ? { tabId: tab.id }
          : { error: `tab ${tab.id} is not a page.` };
      }
      case "show": {
        // In front in its chat, with the chat's pane open; the window's own
        // tabs are the person's, so the tab up stays where it is.
        if (tab.group !== undefined) {
          windowTabs.selectIn(tab.group, tab.id);
          setPaneOpen(tab.group, true);
        }
        return { tabId: tab.id };
      }
    }
  };

  const openers = useRef({ actOnTab, openPage });
  useEffect(() => {
    openers.current = { actOnTab, openPage };
  });
  // A link a person asked a page for in a tab of its own (a middle- or
  // Cmd-click, a link that targets a new window, the page's menu) gets a tab
  // of the window's own, whichever page it was on.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const asks = await rpcClient.browser.events.openInNewTab.call(
          undefined,
          { signal: controller.signal },
        );
        for await (const ask of asks) {
          if (ask.host === WINDOW_BROWSER_HOST) {
            openers.current.openPage(ask.url, {
              behind: ask.background,
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
  }, []);
  useEffect(() => {
    if (!ids) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const asks = await rpcClient.workspace.orchestrator.events.tab.call(
          { id: ids.taskId },
          { signal: controller.signal },
        );
        for await (const request of asks) {
          const answer = await openers.current.actOnTab(request);
          // The answer goes back to the command that asked, so the
          // conversation can hand a tab to a task, or say what went wrong,
          // without waiting for the next message's note.
          void rpcClient.workspace.orchestrator.tabDone.call({
            id: ids.taskId,
            requestId: request.requestId,
            ...answer,
          });
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
