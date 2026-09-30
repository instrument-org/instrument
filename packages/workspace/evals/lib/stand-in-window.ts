/**
 * A window for a run that has none: the tabs a case says the user had open,
 * answering the conversation's `tab` commands the way the app's window does.
 *
 * What it stands in for is the window's bookkeeping, not its pages. A tab id
 * the conversation reads in the note resolves here, `tab open` makes a new id,
 * `close` and `replace` act on the list, and a page tab reads as a live target
 * so `task new --tab` accepts it. A task handed one still browses in a Chrome
 * of its own (the run has no guests), so a case scores what the conversation
 * decided, not what a task saw in the tab.
 */
import { publisher } from "../../src/rpc/publisher";
import { AbsolutePathSchema } from "../../src/schemas/paths";
import { type SessionMessageDataPart } from "../../src/schemas/session/message-data-part";
import { StoreId } from "../../src/schemas/store-id";
import {
  type WindowTabAction,
  type WindowTabTarget,
} from "../../src/schemas/window-tab";
import {
  type BrowserConfig,
  decodeBrowserTargetId,
  encodeBrowserTargetId,
} from "../../src/types";

export interface StandInTab {
  at: string;
  id: string;
  kind: "page" | "screen";
}

export function createStandInWindow() {
  const tabs = new Map<string, StandInTab>();

  const add = (target: WindowTabTarget): StandInTab => {
    const tab: StandInTab =
      target.kind === "page"
        ? {
            at: target.url ?? "about:blank",
            id: StoreId.newSessionId(),
            kind: "page",
          }
        : {
            at: target.mount,
            id: `screen-${crypto.randomUUID()}`,
            kind: "screen",
          };
    tabs.set(tab.id, tab);
    return tab;
  };

  const act = (action: WindowTabAction): { error?: string; tabId?: string } => {
    if (action.kind === "open") {
      return { tabId: add(action.target).id };
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
      case "restore":
      case "show": {
        return { tabId: tab.id };
      }
    }
  };

  /** A page tab of the window, by its target id in the window's terms. */
  const pageOf = (targetId: string) => {
    const decoded = decodeBrowserTargetId(targetId);
    const tab = decoded ? tabs.get(decoded.sessionId) : undefined;
    return decoded && tab?.kind === "page" ? { decoded, tab } : undefined;
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
            ? {
                id: page.decoded.id,
                // Nothing reads a stand-in tab's storage.
                partitionDir: AbsolutePathSchema.parse("/"),
                sessionId: page.decoded.sessionId,
              }
            : meta;
        },
        listTargets: async (id) => [
          ...(await base.listTargets(id)),
          ...[...tabs.values()].flatMap((tab) => {
            const sessionId = StoreId.SessionSchema.safeParse(tab.id);
            return tab.kind === "page" && sessionId.success
              ? [
                  {
                    id: encodeBrowserTargetId(id, sessionId.data),
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
    /** Opens the tabs a case's note names, under the ids the note gives them. */
    seed(viewing: SessionMessageDataPart.ViewContextDataPart | undefined) {
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
            kind: StoreId.SessionSchema.safeParse(tab.id).success
              ? "page"
              : "screen",
          });
        }
      }
    },
    tabs,
  };
}
