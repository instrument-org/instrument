/**
 * A window for a run that has none: the tabs a case says the user had open,
 * answering the conversation's `tab` commands the way the app's window does.
 *
 * What it stands in for is the window's bookkeeping, not its pages. A tab id
 * the conversation reads in the note resolves here, `instrument tab open` makes a new id,
 * `close` and `replace` act on the list, and a page tab reads as a live target
 * so `instrument task new --tab` accepts it. A task handed one still browses in a Chrome
 * of its own (the run has no guests), so a case scores what the conversation
 * decided, not what a task saw in the tab.
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

export interface StandInTab {
  at: string;
  id: string;
  kind: "page" | "screen";
}

export function createStandInWindow() {
  const tabs = new Map<string, StandInTab>();
  /** The user's own tabs outside the chat that a note named, which `tab request` asks for and a Move takes into `tabs`. */
  const theirs = new Map<string, StandInTab>();

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
      return { tabId: add(action.target).id };
    }
    if (action.kind === "list") {
      return {
        tabs: [...tabs.values()].map((tab) =>
          tab.kind === "page"
            ? { id: tab.id, kind: "page" as const, title: "", url: tab.at }
            : { id: tab.id, kind: "screen" as const },
        ),
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
      case "restore":
      case "show": {
        return { tabId: tab.id };
      }
    }
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
        const answer = act(ask.action);
        publisher.publish("window.tabDone", {
          id: ask.id,
          requestId: ask.requestId,
          ...answer,
        });
      });
    },
    /** Opens a page tab under the id given, the way a task's own tab arrives behind. */
    openPage({ at, id }: { at: string; id: string }) {
      tabs.set(id, { at, id, kind: "page" });
    },
    /** Opens the tabs a case's note names, under the ids the note gives them. */
    seed(viewing: SessionMessageDataPart.ViewContextDataPart | undefined) {
      const page = viewing?.page;
      if (page?.tab !== undefined && page.theirs === true) {
        theirs.set(page.tab, { at: page.url, id: page.tab, kind: "page" });
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
        }
      }
    },
    tabs,
  };
}
