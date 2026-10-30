/**
 * A window for a run that has none: the tabs a case says the user had open,
 * answering the conversation's `instrument window` commands the way the app's window does.
 *
 * What it stands in for is the window's bookkeeping, not its pages. A tab id
 * the conversation reads in the note resolves here, `instrument window show <url>` makes a
 * new id and puts it in front, `close` and `show --in` act on the list, and a page tab reads as a live target
 * so `instrument task new --tab` accepts it. A task handed one still browses in a Chrome
 * of its own (the run has no guests), so a case scores what the conversation
 * decided, not what a task saw in the tab. Given a shared Chrome
 * (`sharedBrowser`), each page tab is a real page there instead, which every
 * session of the chat reaches through the bridge and `read` reads.
 */
import { publisher } from "../../src/rpc/publisher";
import { AbsolutePathSchema } from "../../src/schemas/paths";
import { type SessionMessageDataPart } from "../../src/schemas/session/message-data-part";
import { StoreId } from "../../src/schemas/store-id";
import {
  type WindowTabAction,
  type WindowTabAnswer,
  type WindowTabTarget,
} from "../../src/schemas/window-tab";
import {
  type BrowserConfig,
  browserTargetOf,
  parseBrowserTargetId,
} from "../../src/types";
import { type SharedChrome } from "./shared-chrome";

export interface StandInTab {
  at: string;
  id: string;
  kind: "page" | "screen";
}

export function createStandInWindow(chrome?: SharedChrome) {
  const tabs = new Map<string, StandInTab>();
  /** The user's own tabs outside the chat that a note named, which `window request` asks for and a Move takes into `tabs`. */
  const theirs = new Map<string, StandInTab>();
  /** The tab in front: the last one opened, shown or moved in. */
  let front: string | undefined;

  const add = (target: WindowTabTarget): StandInTab => {
    const tab: StandInTab =
      target.kind === "page"
        ? {
            at: target.url ?? "about:blank",
            id: StoreId.newTabId(),
            kind: "page",
          }
        : {
            at: target.path,
            id: StoreId.newTabId(),
            kind: "screen",
          };
    tabs.set(tab.id, tab);
    return tab;
  };

  const act = (action: WindowTabAction): Omit<WindowTabAnswer, "requestId"> => {
    if (action.kind === "open") {
      const tab = add(action.target);
      if (action.show) {
        front = tab.id;
      }
      return { tabId: tab.id };
    }
    if (action.kind === "list") {
      return {
        tabs: [...tabs.values()].map((tab) => ({
          ...(tab.id === front && { front: true }),
          ...(tab.kind === "page"
            ? { id: tab.id, kind: "page" as const, title: "", url: tab.at }
            : { id: tab.id, kind: "screen" as const }),
        })),
      };
    }
    if (action.kind === "adopt") {
      tabs.set(action.tabId, {
        at: action.url,
        id: action.tabId,
        kind: "page",
      });
      return { tabId: action.tabId };
    }
    if (action.kind === "theirs" || action.kind === "take") {
      const own = theirs.get(action.tabId);
      if (!own) {
        return {
          error: `no tab ${action.tabId} of the user's is open outside a chat.`,
        };
      }
      if (action.kind === "theirs") {
        return {
          tabs: [{ id: own.id, kind: "page", title: "", url: own.at }],
        };
      }
      theirs.delete(own.id);
      tabs.set(own.id, own);
      front = own.id;
      return { tabId: own.id };
    }
    const tab = tabs.get(action.tabId);
    if (!tab) {
      return { error: `no tab ${action.tabId} is open in this chat.` };
    }
    switch (action.kind) {
      case "close": {
        tabs.delete(tab.id);
        return { tabId: tab.id };
      }
      case "replace": {
        const { target } = action;
        if (target.kind === "page" && tab.kind === "page") {
          tabs.set(tab.id, { ...tab, at: target.url ?? tab.at });
          return { tabId: tab.id };
        }
        tabs.delete(tab.id);
        return { tabId: add(target).id };
      }
      case "read": {
        return { error: "the stand-in window has no page to read." };
      }
      case "restore": {
        return { tabId: tab.id };
      }
      case "show": {
        front = tab.id;
        return { tabId: tab.id };
      }
    }
  };

  /**
   * The window's answer, with the shared Chrome (when the run has one) made
   * to match: a page tab opened, sent elsewhere, closed, brought back or read
   * there, so every session of the chat reaches the same page.
   */
  const actOnPages = async (
    action: WindowTabAction,
  ): Promise<Omit<WindowTabAnswer, "requestId">> => {
    if (!chrome) {
      return act(action);
    }
    if (action.kind === "read") {
      const tab = tabs.get(action.tabId);
      if (!tab || tab.kind !== "page") {
        return { error: `no tab ${action.tabId} is open in this chat.` };
      }
      await chrome.ensure(tab.id, tab.at);
      const text = await chrome.evaluate(tab.id, "document.body.innerText");
      return { tabId: tab.id, text: typeof text === "string" ? text : "" };
    }
    const answer = act(action);
    const { tabId } = answer;
    if (action.kind === "open" && tabId && action.target.kind === "page") {
      await chrome.ensure(tabId, action.target.url ?? "about:blank");
    } else if (
      action.kind === "replace" &&
      tabId &&
      action.target.kind === "page"
    ) {
      await chrome.ensure(tabId);
      await chrome.navigate(tabId, action.target.url ?? "about:blank");
    } else if (action.kind === "restore" && tabId) {
      await chrome.ensure(tabId, tabs.get(tabId)?.at);
    } else if (action.kind === "close" && tabId) {
      await chrome.remove(tabId);
    } else if (action.kind === "list" && answer.tabs) {
      const live = new Map(chrome.pages().map((page) => [page.id, page]));
      return {
        tabs: answer.tabs.map((tab) => {
          const page = live.get(tab.id);
          return tab.kind === "page" && page
            ? { ...tab, title: page.title, url: page.url }
            : tab;
        }),
      };
    }
    return answer;
  };

  /** A page tab of the window, by its target id. */
  const pageOf = (targetId: string) => {
    const tab =
      parseBrowserTargetId(targetId) === null ? undefined : tabs.get(targetId);
    return tab?.kind === "page" ? tab : undefined;
  };

  return {
    /** The browser config with the window's page tabs live, for `--tab` to accept. */
    browser(base: BrowserConfig): BrowserConfig {
      return {
        ...base,
        getTargetMeta: (targetId) => {
          const page = pageOf(targetId);
          const meta = base.getTargetMeta(targetId);
          return page && !meta
            ? // Nothing reads a stand-in tab's storage.
              { partitionDir: AbsolutePathSchema.parse("/") }
            : meta;
        },
        listTargets: async () => [
          ...(await base.listTargets()),
          ...[...tabs.values()].flatMap((tab) => {
            const tabId = StoreId.TabSchema.safeParse(tab.id);
            return tab.kind === "page" && tabId.success
              ? [
                  {
                    id: browserTargetOf(tabId.data),
                    title: "",
                    type: "page" as const,
                    url: tab.at,
                  },
                ]
              : [];
          }),
        ],
      };
    },
    /** Answers the run's asks of the window until the returned function is called. */
    listen(): () => void {
      return publisher.subscribe("window.tab", (ask) => {
        void actOnPages(ask.action)
          .catch((error: unknown) => ({
            error: error instanceof Error ? error.message : String(error),
          }))
          .then((answer) => {
            publisher.publish("window.tabDone", {
              id: ask.id,
              requestId: ask.requestId,
              ...answer,
            });
          });
      });
    },
    /** Opens a page tab under the id given, the way a task's own tab arrives behind. */
    openPage({ at, id }: { at: string; id: string }) {
      tabs.set(id, { at, id, kind: "page" });
    },
    /** Opens the tabs a case's note names, under the ids the note gives them. */
    seed(viewing: SessionMessageDataPart.ViewContextDataPart | undefined) {
      const shown = viewing?.page;
      if (shown?.tab !== undefined && shown.theirs === true) {
        theirs.set(shown.tab, { at: shown.url, id: shown.tab, kind: "page" });
      }
      for (const tab of [
        ...(viewing?.tabs ?? []),
        ...(viewing?.page?.tabs ?? []).map((page) => ({
          at: page.url,
          id: page.id,
        })),
      ]) {
        if (tab.id) {
          tabs.set(tab.id, {
            at: tab.at,
            id: tab.id,
            // A page is at an address; a file or a screen at a path or route.
            kind: /^[a-z][a-z+.-]*:/i.test(tab.at) ? "page" : "screen",
          });
          if (chrome && /^https?:/i.test(tab.at)) {
            void chrome.ensure(tab.id, tab.at);
          }
        }
      }
    },
    tabs,
  };
}
