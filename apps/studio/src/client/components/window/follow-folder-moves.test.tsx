import { appTabsAtom } from "@/client/components/window/app-tabs";
import { useGroupTabRouters } from "@/client/hooks/use-group-tab-routers";
import { useTabRouters } from "@/client/hooks/use-tab-routers";
import { getGroupTabRouter } from "@/client/lib/group-tab-router-registry";
import { clearKeptState, writeKept } from "@/client/lib/kept-state";
import { getRouterHistory } from "@/client/lib/tab-router-history";
import { getTabRouter } from "@/client/lib/tab-router-registry";
import { fileHref, folderHref } from "@/shared/computer-href";
import { fileOfTabGroup, WINDOW_TABS_KEY } from "@/shared/kept-state";
import { TabIdSchema } from "@/shared/tabs";
import { renderWithProviders } from "@/tests/render";
import { StoreId } from "@instrument-org/workspace/client";
import { useAtomValue } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFollowFolderMoves } from "./follow-folder-moves";
import { tabsAfterMove } from "./tab-model";
import { useWindowTabs, windowTabsAtom } from "./window-tabs";

const moved = vi.hoisted(() => {
  let send: (move: { from: string; id: string; to: string }) => void = () =>
    undefined;
  const sent = new Promise<{ from: string; id: string; to: string }>(
    (resolve) => {
      send = resolve;
    },
  );
  return { send: (move: Parameters<typeof send>[0]) => send(move), sent };
});

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    workspace: {
      chats: {
        events: {
          folderMoved: {
            call: vi.fn(() =>
              Promise.resolve(
                (async function* () {
                  yield await moved.sent;
                })(),
              ),
            ),
          },
        },
      },
    },
  },
}));

const CHAT = StoreId.SessionSchema.parse("ses_01JAAAAAAAAAAAAAAAAAAAAAAA");
const CHATS = "/Users/mac-user/Instrument/Chats";
const FIRST = `${CHATS}/Make me a pretty page about The Star`;
const TITLED = `${CHATS}/The Star through five centuries`;
const PAGE = "The Star tarot.html";
const SIBLING = `${FIRST} again/notes.md`;

/** The window as `WindowShell` has it: routers for both kinds of tab, following moves. */
function Window() {
  const windowTabs = useWindowTabs();
  useTabRouters(useAtomValue(appTabsAtom).tabs);
  useGroupTabRouters(windowTabs.allTabs, windowTabs.screenMoved);
  useFollowFolderMoves(true);
  return null;
}

beforeEach(() => {
  clearKeptState();
});

afterEach(() => {
  clearKeptState();
});

describe("a chat's folder moving to its title", () => {
  it("takes the tabs standing in it along, open, closed and stepped from", async () => {
    // The page the agent opened in the chat during its first turn, a step on
    // from the folder, as `instrument window show` leaves it.
    const paneTab = StoreId.newTabId();
    writeKept(fileOfTabGroup(CHAT), `${WINDOW_TABS_KEY}/${CHAT}`, {
      active: paneTab,
      tabs: [
        {
          group: CHAT,
          history: {
            entries: [folderHref(FIRST), fileHref(`${FIRST}/${PAGE}`)],
            index: 1,
          },
          href: fileHref(`${FIRST}/${PAGE}`),
          id: paneTab,
          isOpened: true,
          kind: "screen",
        },
        {
          group: CHAT,
          href: fileHref(SIBLING),
          id: StoreId.newTabId(),
          kind: "screen",
        },
      ],
    });
    const windowTab = TabIdSchema.parse("t-folder");
    const { store } = renderWithProviders(<Window />);
    store.set(appTabsAtom, {
      recentlyClosed: [
        {
          id: TabIdSchema.parse("t-closed"),
          pathname: fileHref(`${FIRST}/a.md`),
        },
      ],
      selectedId: windowTab,
      tabs: [{ id: windowTab, pathname: folderHref(FIRST) }],
    });
    await vi.waitFor(() => {
      expect(getTabRouter(windowTab)).toBeDefined();
    });

    moved.send({ from: FIRST, id: CHAT, to: TITLED });

    await vi.waitFor(() => {
      expect(getGroupTabRouter(paneTab)?.history.location.href).toBe(
        fileHref(`${TITLED}/${PAGE}`),
      );
    });
    const router = getGroupTabRouter(paneTab);
    expect(router && getRouterHistory(router).entries).toEqual([
      folderHref(TITLED),
      fileHref(`${TITLED}/${PAGE}`),
    ]);
    expect(
      store
        .get(windowTabsAtom)
        .tabs.map((tab) => (tab.kind === "screen" ? tab.href : tab.url)),
    ).toEqual([fileHref(`${TITLED}/${PAGE}`), fileHref(SIBLING)]);
    expect(getTabRouter(windowTab)?.history.location.href).toBe(
      folderHref(TITLED),
    );
    const appTabs = store.get(appTabsAtom);
    expect(appTabs.tabs[0]?.pathname).toBe(folderHref(TITLED));
    expect(appTabs.recentlyClosed[0]?.pathname).toBe(
      fileHref(`${TITLED}/a.md`),
    );
  });
});

describe("tabsAfterMove", () => {
  it("hands back the tabs themselves when no address moved, so nothing is written", () => {
    const state = {
      activeByGroup: {},
      tabs: [
        {
          group: CHAT,
          href: fileHref(SIBLING),
          id: "tab_1",
          kind: "screen" as const,
          past: [
            { href: `/chats/${CHAT}`, id: "tab_2", kind: "screen" as const },
          ],
        },
      ],
    };
    expect(tabsAfterMove(state, (href) => href)).toBe(state);
  });
});
